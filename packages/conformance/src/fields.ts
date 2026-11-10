/**
 * Field rules in the leak walk: for every successful answer of every walk, each row it carries is checked against
 * the read rules of its entity's fields. The harness predicts, from the IR and the database alone, whether the
 * caller may read each such field on that row, and the key must be in the row exactly then: absent when the rule
 * refuses (a leak otherwise), present when it allows (a presenter that withholds too much otherwise).
 *
 * The prediction is made when the answer arrives, before the walk makes its next call, so the row and the
 * caller's memberships are the ones the server answered from. A row that is gone by then (a concurrent delete of
 * the order walk) is counted and not judged.
 */
import {
  openValue,
  ruledColumns,
  ruleText,
  type EntityIR,
  type IR,
  type OperationIR,
  type RuleIR,
  type ResourceIR
} from "@osl/core";
import type { HarnessClient, Reply } from "./client.js";
import { memberTenantIds, verdict, type Resolver, type Row, type Session } from "./rules.js";

/** The rows an answer carries, by where they sit in the body */
interface Shape {
  entity: EntityIR;
  /** Included relations by their key in the row, each with the entity of its rows */
  nested: Map<string, EntityIR>;
  /** Whether `data` is a list of rows */
  many: boolean;
}

export class FieldWatch {
  readonly findings: string[] = [];
  /** How many field decisions were predicted and held: the key was there, or was not */
  present = 0;
  absent = 0;
  rows = 0;
  gone = 0;
  /** `fields` answers of sessions compared with what the rules say of them */
  sessions = 0;
  /** Sealed values an allowed caller was answered, each compared with what its column holds once opened */
  opened = 0;
  private readonly signedIn = new Map<HarnessClient, unknown>();
  private readonly shapes = new Map<string, Shape>();
  private readonly identity: EntityIR | null;
  private readonly roles: string[];

  constructor(
    private readonly ir: IR,
    private readonly resolver: Resolver,
    private readonly max: number,
    /** The key the app seals under in this run: the database holds ciphertext, so a sealed field's value is compared, not only its presence */
    private readonly sealKey?: Buffer
  ) {
    this.identity = ir.auth ? ir.entities.find(e => e.name === ir.auth!.identity)! : null;
    this.roles = ir.auth?.tenancy?.roles ?? [];
    const entity = (name: string) => ir.entities.find(e => e.name === name)!;
    const nestedOf = (resource: ResourceIR, op: OperationIR): Map<string, EntityIR> => {
      const owner = entity(resource.entity);
      const nested = new Map<string, EntityIR>();
      if (op.kind !== "list" && op.kind !== "get") return nested;
      for (const name of op.include) {
        const rel = owner.relations.find(r => r.name === name);
        if (rel) nested.set(name, entity(rel.target));
      }
      for (const name of op.through ?? []) {
        const rel = owner.through?.find(t => t.name === name);
        if (rel) nested.set(name, entity(rel.target));
      }
      return nested;
    };
    for (const resource of ir.resources)
      for (const op of resource.operations)
        if (op.kind !== "delete")
          this.shapes.set(`${resource.name}.${op.kind}`, {
            entity: entity(resource.entity),
            nested: nestedOf(resource, op),
            many: op.kind === "list"
          });
    for (const action of ir.actions)
      if (action.returns.kind === "entity" && action.entity)
        this.shapes.set(`${action.resource ?? "actions"}.${action.name}`, {
          entity: entity(action.entity),
          nested: new Map(),
          many: false
        });
    if (this.identity)
      for (const kind of ["register", "login", "me", "magic_link_verify", "invite_accept"])
        this.shapes.set(`auth.${kind}`, { entity: this.identity, nested: new Map(), many: false });
  }

  /** Whether any shape the walks can see has a field with a read rule: without one there is nothing to watch */
  get active(): boolean {
    return [...this.shapes.values()].some(
      s => ruledColumns(s.entity).length > 0 || [...s.nested.values()].some(e => ruledColumns(e).length > 0)
    );
  }

  /** Called with every reply, before the walk goes on */
  async observe(label: string, reply: Reply, client: HarnessClient): Promise<void> {
    const pk = this.identity?.primaryKey[0] ?? "id";
    const data = (reply.body as { data?: unknown } | null)?.data;
    if (label === "auth.logout") this.signedIn.delete(client);
    // An accept that makes the account signs it in, as a registration does
    const signsIn = label === "auth.login" || label === "auth.register" || label === "auth.invite_accept";
    if (signsIn && reply.status < 300 && data && typeof data === "object") this.signedIn.set(client, (data as Row)[pk]);
    if (reply.status >= 300 || !this.active) return;
    const shape = this.shapes.get(label);
    if (!shape || data == null) return;
    const session = await this.sessionOf(client);
    const items = shape.many ? (Array.isArray(data) ? data : []) : [data];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      await this.judge(label, session, shape.entity, item as Row, "data");
      for (const [key, target] of shape.nested) {
        const inner = (item as Row)[key];
        const list = Array.isArray(inner) ? inner : inner ? [inner] : [];
        for (const row of list)
          if (row && typeof row === "object") await this.judge(label, session, target, row as Row, `data.${key}`);
      }
    }
  }

  /** The session the server answered this client with: the user row and memberships as the database has them now */
  private async sessionOf(client: HarnessClient): Promise<Session | null> {
    const id = this.signedIn.get(client);
    if (id == null || !this.identity) return null;
    const user = await this.resolver.fresh(this.identity, id);
    if (!user) return null;
    return { id, user, memberships: await this.resolver.memberships(id) };
  }

  private async judge(label: string, session: Session | null, entity: EntityIR, row: Row, where: string) {
    const columns = ruledColumns(entity);
    if (!columns.length) return;
    const stored = await this.resolver.fresh(entity, row[entity.primaryKey[0]]);
    if (!stored) {
      this.gone++;
      return;
    }
    this.rows++;
    const who = session ? String(session.user[this.ir.auth!.emailColumn] ?? session.id) : "anonymous";
    for (const column of columns) {
      const allowed = verdict(column.read!, session, stored, this.roles).ok;
      const there = column.name in row;
      if (allowed === there) {
        if (there) this.present++;
        else this.absent++;
        if (there && column.sealed && this.sealKey) {
          // What an allowed caller reads is exactly what the column holds once opened, by the reference and not by the app
          const held = stored[column.name];
          let expected: string | null | undefined;
          try {
            expected =
              held == null ? null : openValue(this.sealKey, `${entity.table}.${column.name}`, held as Uint8Array);
          } catch (error) {
            expected = undefined;
            if (this.findings.length < this.max)
              this.findings.push(
                `${label} as ${who}: ${where}.${column.name} was answered, and what ${entity.table}.${column.name} holds does not open under the run's key (${error instanceof Error ? error.message : error})`
              );
          }
          if (expected !== undefined) {
            this.opened++;
            if (row[column.name] !== expected && this.findings.length < this.max)
              this.findings.push(
                `${label} as ${who}: ${where}.${column.name} is not what ${entity.table}.${column.name} holds once opened`
              );
          }
        }
        continue;
      }
      if (this.findings.length >= this.max) return;
      const rule = ruleText(column.read!);
      this.findings.push(
        there
          ? `${label} as ${who}: ${where}.${column.name} is in the response, and ${entity.name}.${column.name} is read by "${rule}", which refuses this caller on this row`
          : `${label} as ${who}: ${where}.${column.name} is missing, and ${entity.name}.${column.name} is read by "${rule}", which allows this caller on this row`
      );
    }
  }

  /** What a session is told of its fields against what the rules say of it before any row */
  compareFields(who: string, session: Session | null, answered: unknown): void {
    this.sessions++;
    for (const resource of this.ir.resources) {
      const entity = this.ir.entities.find(e => e.name === resource.entity)!;
      for (const column of ruledColumns(entity)) {
        const expected = this.could(column.read!, session);
        const got = (answered as Record<string, Record<string, unknown>> | null)?.[resource.name]?.[column.name];
        if (got !== expected && this.findings.length < this.max)
          this.findings.push(
            `fields as ${who}: ${resource.name}.${column.name} is ${JSON.stringify(got)}, and "${ruleText(column.read!)}" says ${expected} of this session`
          );
      }
    }
  }

  /** Whether the session could read a field under the rule on some row: the rule before any row, and for a member predicate a membership of that rank held at all */
  private could(rule: RuleIR, session: Session | null): boolean {
    switch (rule.kind) {
      case "all":
        return rule.rules.every(part => this.could(part, session));
      case "any":
        return rule.rules.some(alternative => this.could(alternative, session));
      case "member":
        return memberTenantIds(session, this.roles, rule.role).length > 0;
      default:
        return verdict(rule, session, null, this.roles).ok;
    }
  }

  summary(): string {
    if (!this.active) return "";
    return `; ${this.present + this.absent} fields with a read rule predicted on ${this.rows} rows as their caller (${this.present} present, ${this.absent} absent${this.gone ? `, ${this.gone} rows gone before they could be read` : ""})${this.sessions ? `, the fields answer of ${this.sessions} sessions compared` : ""}${this.opened ? `, ${this.opened} sealed values compared with what their columns hold once opened` : ""}`;
  }
}
