import { describe, expect, it } from "vitest";
import type { ColumnIR, EntityIR, RuleIR } from "@osl/core";
import { createChecksBody, createOp, precheck, rowOp, verdict, type Session } from "../src/rules.js";
import { badIds, invalidProbes, Rng, validBody, validValue, type BodyContext } from "../src/bodies.js";

const alice: Session = {
  id: "a1",
  user: { id: "a1", role: "member" },
  memberships: [{ tenant: "t1", role: "member" }]
};
const admin: Session = { id: "ad", user: { id: "ad", role: "admin" }, memberships: [] };
const ROLES = ["owner", "admin", "member"];

const owner: RuleIR = { kind: "owner", field: "author_id" };
const publicWhenPublished: RuleIR = { kind: "public", when: { column: "published", op: "eq", value: true } };
const draftsOrOwner: RuleIR = { kind: "any", rules: [publicWhenPublished, owner] };

function entity(read: RuleIR, hidden: "forbidden" | "not_found" = "forbidden"): EntityIR {
  return {
    name: "Post",
    table: "posts",
    primaryKey: ["id"],
    columns: [],
    foreignKeys: [],
    uniques: [],
    indexes: [],
    relations: [],
    rules: { read, create: owner, update: owner, delete: owner },
    hidden,
    display: "title"
  };
}

describe("the harness's verdict", () => {
  it("answers as the generated access module does", () => {
    expect(verdict({ kind: "public" }, null, null, ROLES)).toEqual({ ok: true });
    expect(verdict({ kind: "authenticated" }, null, null, ROLES)).toEqual({ ok: false, status: 401 });
    expect(verdict({ kind: "none" }, alice, null, ROLES)).toEqual({ ok: false, status: 403 });
    expect(verdict({ kind: "role", value: "admin" }, alice, null, ROLES)).toEqual({ ok: false, status: 403 });
    expect(verdict({ kind: "role", value: "admin" }, admin, null, ROLES)).toEqual({ ok: true });
    expect(verdict(owner, alice, { author_id: "a1" }, ROLES)).toEqual({ ok: true });
    expect(verdict(owner, alice, { author_id: "b2" }, ROLES)).toEqual({ ok: false, status: 403 });
    expect(verdict(owner, alice, null, ROLES)).toEqual({ ok: true });
  });

  it("ranks membership roles in the tenancy's order and compares ids as text", () => {
    const member: RuleIR = { kind: "member", field: "team_id" };
    const atLeastAdmin: RuleIR = { kind: "member", field: "team_id", role: "admin" };
    expect(verdict(member, alice, { team_id: "t1" }, ROLES)).toEqual({ ok: true });
    expect(verdict(member, alice, { team_id: "t2" }, ROLES)).toEqual({ ok: false, status: 403 });
    expect(verdict(atLeastAdmin, alice, { team_id: "t1" }, ROLES)).toEqual({ ok: false, status: 403 });
    const numeric: Session = { ...alice, id: 7, memberships: [{ tenant: 3, role: "owner" }] };
    expect(verdict(atLeastAdmin, numeric, { team_id: "3" }, ROLES)).toEqual({ ok: true });
    expect(verdict({ kind: "owner", field: "user_id" }, numeric, { user_id: "7" }, ROLES)).toEqual({ ok: true });
  });

  it("answers 401 for an anonymous caller when any alternative wanted a session, else 403", () => {
    const draft = { published: false, author_id: "a1" };
    expect(verdict(draftsOrOwner, null, draft, ROLES)).toEqual({ ok: false, status: 401 });
    expect(verdict(draftsOrOwner, admin, draft, ROLES)).toEqual({ ok: false, status: 403 });
    expect(verdict(draftsOrOwner, null, { ...draft, published: true }, ROLES)).toEqual({ ok: true });
    const conjunction: RuleIR = { kind: "all", rules: [{ kind: "member", field: "team_id" }, owner] };
    expect(verdict(conjunction, alice, { team_id: "t1", author_id: "a1" }, ROLES)).toEqual({ ok: true });
    expect(verdict(conjunction, alice, { team_id: "t1", author_id: "b2" }, ROLES)).toEqual({ ok: false, status: 403 });
    expect(verdict(conjunction, null, { team_id: "t1", author_id: "a1" }, ROLES)).toEqual({ ok: false, status: 401 });
  });

  it("reads condition values through relations under their dotted key", () => {
    const viaProject: RuleIR = {
      kind: "public",
      when: {
        column: "public",
        op: "eq",
        value: true,
        via: [{ column: "project_id", entity: "Project", table: "projects", targetColumn: "id" }]
      }
    };
    expect(verdict(viaProject, null, { "project_id.public": true }, ROLES)).toEqual({ ok: true });
    expect(verdict(viaProject, null, { "project_id.public": false }, ROLES)).toEqual({ ok: false, status: 403 });
  });
});

describe("what an operation is expected to answer", () => {
  it("hides a row as 403, or as 404 under hidden: not_found, after the check before the row", () => {
    const draft = { published: false, author_id: "a1" };
    const forbidden = entity(draftsOrOwner);
    const notFound = entity(draftsOrOwner, "not_found");
    expect(rowOp(draftsOrOwner, forbidden, null, draft, ROLES, true)).toEqual({ allow: false, status: 401 });
    expect(rowOp(draftsOrOwner, notFound, null, draft, ROLES, true)).toEqual({ allow: false, status: 404 });
    expect(rowOp(draftsOrOwner, notFound, admin, draft, ROLES, true)).toEqual({ allow: false, status: 404 });
    expect(rowOp(draftsOrOwner, notFound, alice, draft, ROLES, true)).toEqual({ allow: true });
    // An update of a hidden row answers 404 before its own rule; of a visible row it answers its own rule
    expect(rowOp(owner, notFound, admin, draft, ROLES, false)).toEqual({ allow: false, status: 404 });
    expect(rowOp(owner, notFound, admin, { ...draft, published: true }, ROLES, false)).toEqual({
      allow: false,
      status: 403
    });
    // The check before the row still answers 401 to an anonymous caller when every alternative needs a session
    const ownerOnly = entity(owner, "not_found");
    expect(rowOp(owner, ownerOnly, null, draft, ROLES, true)).toEqual({ allow: false, status: 401 });
  });

  it("checks a create's body only when the rule reads it", () => {
    expect(createChecksBody(owner)).toBe(false);
    expect(createChecksBody({ kind: "member", field: "team_id" })).toBe(true);
    expect(createChecksBody(publicWhenPublished)).toBe(true);
    const member: RuleIR = { kind: "member", field: "team_id" };
    expect(createOp(member, alice, { team_id: "t2" }, ROLES)).toEqual({ allow: false, status: 403 });
    expect(createOp(member, alice, { team_id: "t1" }, ROLES)).toEqual({ allow: true });
    expect(createOp(owner, alice, {}, ROLES)).toEqual({ allow: true });
    expect(precheck(owner, null, ROLES)).toEqual({ allow: false, status: 401 });
  });
});

describe("the bodies the walks send", () => {
  const column = (name: string, extra: Partial<ColumnIR> = {}): ColumnIR => ({
    name,
    type: { kind: "scalar", scalar: "string" },
    nullable: false,
    unique: false,
    primary: false,
    hidden: false,
    ...extra
  });
  const ctx = (): BodyContext => {
    let n = 0;
    return { ir: { enums: [] } as never, rng: new Rng(7), next: () => ++n, relatedId: () => "related-1" };
  };

  it("is deterministic for a seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect([a.next(), a.int(10), a.uuid()]).toEqual([b.next(), b.int(10), b.uuid()]);
  });

  it("fills required fields within their validation, leaves optional ones out and points relations at the walk's rows", () => {
    const post: EntityIR = {
      ...entity(owner),
      columns: [
        column("id", { primary: true, type: { kind: "scalar", scalar: "uuid" } }),
        column("title", { maxLength: 8, validate: { min_length: 3 } }),
        column("email", { validate: { format: "email" } }),
        column("note", { nullable: true }),
        column("author_id", { type: { kind: "scalar", scalar: "uuid" } }),
        column("views", { type: { kind: "scalar", scalar: "integer" }, validate: { min: 10, max: 20 } }),
        column("cover", { type: { kind: "file" } })
      ],
      foreignKeys: [
        {
          name: "fk",
          column: "author_id",
          targetEntity: "User",
          targetTable: "users",
          targetColumn: "id",
          onDelete: "cascade"
        }
      ]
    };
    const { body, missing } = validBody(
      post,
      ["title", "email", "note", "author_id", "views", "cover"],
      ctx(),
      new Set()
    );
    expect(String(body.title).length).toBeLessThanOrEqual(8);
    expect(String(body.title).length).toBeGreaterThanOrEqual(3);
    expect(body.email).toMatch(/@example\.com$/);
    expect(body.note).toBeUndefined();
    expect(body.author_id).toBe("related-1");
    expect(body.views).toBe(10);
    expect(missing).toEqual(["cover"]);
  });

  it("probes every way a body can be wrong, and leaves fields out only for a create", () => {
    const columns = [
      column("title", { maxLength: 5 }),
      column("count", { type: { kind: "scalar", scalar: "integer" } }),
      column("secret", { hidden: true })
    ];
    const valid = { title: "ok", count: 1 };
    const create = invalidProbes(columns, ["title", "count"], valid, ctx());
    const names = create.map(p => p.name);
    expect(names).toContain("extra key");
    expect(names).toContain("wrong type for count");
    expect(names).toContain("title longer than 5");
    expect(names).toContain("missing title");
    expect(names).toContain("null title");
    expect(names).toContain("server-owned secret sent");
    expect(create.find(p => p.name === "wrong type for count")!.body.count).toBe("twelve");
    const update = invalidProbes(columns, ["title", "count"], valid, ctx(), true);
    expect(update.map(p => p.name)).not.toContain("missing title");
    expect(update.map(p => p.name)).toContain("null title");
  });

  it("fills a sealed field, and a value that follows an enum with the shape of the value it names", () => {
    const config = column("config", {
      type: { kind: "scalar", scalar: "json" },
      shapeBy: {
        column: "kind",
        shapes: [
          {
            value: "webhook",
            keys: [
              { name: "url", kind: "string", required: true, maxLength: 255, validate: { format: "url" } },
              { name: "retries", kind: "integer", required: false, default: 3, validate: { min: 0, max: 10 } }
            ]
          },
          { value: "slack", keys: [{ name: "channel", kind: "string", required: true, maxLength: 80 }] }
        ]
      }
    });
    const kind = column("kind", { type: { kind: "enum", name: "integration_kind" } });
    const integration: EntityIR = {
      ...entity(owner),
      columns: [kind, config, column("secret", { nullable: true, sealed: true }), column("note", { nullable: true })]
    };
    const bodies: BodyContext = {
      ...ctx(),
      ir: { enums: [{ name: "integration_kind", values: ["webhook", "slack"] }] } as never
    };
    const { body, missing } = validBody(integration, ["kind", "config", "secret", "note"], bodies, new Set());
    expect(missing).toEqual([]);
    expect(body.kind).toBe("webhook");
    expect(body.config).toMatchObject({ url: expect.stringMatching(/^https:\/\/example\.com\//) });
    expect(typeof body.secret).toBe("string");
    expect(body.note).toBeUndefined();

    // Every way the value can miss its shape, each with the key a refusal must name
    const probes = invalidProbes(integration.columns, ["kind", "config"], body, bodies);
    const path = (name: string) => probes.find(p => p.name === name)?.path;
    expect(path("config with a wrong type at config.url")).toBe("config.url");
    expect(path("config with config.url left out")).toBe("config.url");
    expect(path("config with null at config.retries")).toBe("config.retries");
    expect(path("config with a fraction at config.retries")).toBe("config.retries");
    expect(path("config with an unknown key at config.osl_fuzz_unknown_key")).toBe("config.osl_fuzz_unknown_key");
    expect(path("config with an array where config is an object")).toBe("config");
    expect(path("config with the shape of kind slack on a row that is webhook")).toBe("config.url");
    // A required key held to a pattern cannot be made up: the walk has no body, as for such a column
    const strict = column("code", {
      type: { kind: "scalar", scalar: "json" },
      shape: [{ name: "sku", kind: "string", required: true, validate: { pattern: "^[A-Z]{3}-\\d{4}$" } }]
    });
    expect(validValue(strict, bodies)).toBeUndefined();
    expect(validBody({ ...integration, columns: [strict] }, ["code"], bodies, new Set()).missing).toEqual(["code"]);
    // An update reads the enum's value from the stored row, and may not change it without the value
    const update = invalidProbes(integration.columns, ["kind", "config"], {}, bodies, true, {
      kind: "slack",
      config: { channel: "#ops" }
    });
    expect(update.find(p => p.name === "config with config.channel left out")?.path).toBe("config.channel");
    const changed = update.find(p => p.name === "kind changed to webhook without config")!;
    expect(changed.body).toEqual({ kind: "webhook" });
    expect(changed.path).toBe("config");
  });

  it("knows a malformed id from a missing one", () => {
    const uuid = badIds(column("id", { type: { kind: "scalar", scalar: "uuid" } }), ctx());
    expect(uuid.map(b => b.shape)).toEqual(["wrong", "missing"]);
    const integer = badIds(column("id", { type: { kind: "scalar", scalar: "integer" } }), ctx());
    expect(integer.map(b => b.id)).toEqual(["abc", "-1", "2147483000"]);
    expect(validValue(column("when", { type: { kind: "scalar", scalar: "datetime" } }), ctx())).toMatch(/^2026-01-/);
  });
});
