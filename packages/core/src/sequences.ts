/**
 * The database side of a sequence field (`type: sequence`): the counter table, and per field the trigger function
 * and the trigger that number each new row, as a pure function of the IR. Migrations create and drop them with the
 * isolation layer's objects, the ordered collections' and the counts', and the drift check compares them with the
 * live database.
 *
 * The number is assigned in the database so that every writer gets one, whatever code it is: a generated handler,
 * an action handler of the user's, a seed. A cascade is not a handler, and neither is an INSERT someone types.
 *
 * - One table, `osl_sequences`: a row per sequence and scope holding the last number given.
 * - One `BEFORE INSERT` row trigger per sequence field. It takes the counter of the new row's scope with
 *   `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, which creates the counter or adds one to it and holds its row
 *   until the transaction ends. Two creates in one scope therefore never share a number: the second waits for the
 *   first to commit or roll back and counts on from what it left.
 * - The counter is written in the create's own transaction. A create that rolls back gives its number back, so a
 *   scope's numbers are consecutive in the order the creates committed; a hole appears only where a row was
 *   deleted afterwards. The price is that creates in one scope wait for one another, which is why a scope is
 *   usually the tenant.
 * - Whatever a writer puts in the column is overwritten, and UNIQUE (scope..., number) stands behind the counter.
 *
 * Triggers on one table fire in name order: `osl_count_hold` and `osl_order_assign` come before `osl_sequence_*`,
 * so on a table that is also ordered (order.ts) or counted (counts.ts) every insert takes the parent first and the
 * counter last, all in the same order, and a writer waiting for a counter is never waited for by its holder.
 *
 * Under `isolation: database` the web role has no grant on the counter table: a counter scoped by tenant says how
 * many rows a tenant has made, and no policy could let a caller add to a counter without also letting it read
 * one. The trigger functions run with their owner's rights instead, like a count's; each touches the one counter
 * the row being inserted names, reads nothing else and answers nothing but the number put on that row. A row the
 * policy then refuses takes its statement, and the counter's step with it, back.
 */
import type { EntityIR, IR, SequenceIR } from "./ir.js";
import { SEQUENCE_TABLE } from "./ir.js";
import type { IsolationObject } from "./isolation.js";
import { quoteIdent, quoteLiteral } from "./migrations.js";

const DEFINER = "SECURITY DEFINER SET search_path = public, pg_temp";

/** Whether any entity of the IR has a sequence field */
export function hasSequences(ir: IR): boolean {
  return ir.entities.some(e => e.sequences?.length);
}

/** The counter a row belongs to, as text: the scope's values in a JSON array, so no two scopes spell alike */
export function scopeExpression(sequence: SequenceIR, alias: string): string {
  if (!sequence.scope.length) return quoteLiteral("[]");
  return `jsonb_build_array(${sequence.scope.map(c => `${alias}.${quoteIdent(c)}`).join(", ")})::text`;
}

/** The number as it is written: the prefix, then the count padded with zeros to the width (a longer count keeps its digits) */
export function numberExpression(sequence: SequenceIR, count: string): string {
  const digits =
    sequence.width > 1
      ? `lpad(${count}::text, greatest(${sequence.width}, length(${count}::text)), '0')`
      : `${count}::text`;
  return sequence.prefix ? `${quoteLiteral(sequence.prefix)} || ${digits}` : digits;
}

/** The body of a sequence's trigger function */
export function sequenceFunctionSource(sequence: SequenceIR): string {
  const table = quoteIdent(SEQUENCE_TABLE);
  return [
    "DECLARE",
    "  osl_count bigint;",
    "BEGIN",
    "  -- The counter of the row's scope, made on first use and held until this transaction ends: whoever creates",
    "  -- next in the scope waits here and counts on from what this one leaves, or from before it if it rolls back",
    `  INSERT INTO ${table} AS s ("sequence", "scope", "last")`,
    `  VALUES (${quoteLiteral(sequence.key)}, ${scopeExpression(sequence, "NEW")}, 1)`,
    `  ON CONFLICT ("sequence", "scope") DO UPDATE SET "last" = s."last" + 1`,
    `  RETURNING s."last" INTO osl_count;`,
    `  NEW.${quoteIdent(sequence.column)} := ${numberExpression(sequence, "osl_count")};`,
    "  RETURN NEW;",
    "END"
  ].join("\n");
}

/**
 * The statement that numbers the rows a table already has when a sequence field arrives on it: scope by scope, in
 * the order the rows were made where the table says (created_at), then by key.
 */
export function backfillSequence(entity: EntityIR, sequence: SequenceIR): string {
  const table = quoteIdent(entity.table);
  const first = entity.columns.some(c => c.name === "created_at") ? `${quoteIdent("created_at")}, ` : "";
  const keys = entity.primaryKey.map(quoteIdent);
  const partition = sequence.scope.length ? `PARTITION BY ${sequence.scope.map(quoteIdent).join(", ")} ` : "";
  const match = entity.primaryKey.map(k => `r.${quoteIdent(k)} = o.${quoteIdent(k)}`).join(" AND ");
  return `UPDATE ${table} AS r SET ${quoteIdent(sequence.column)} = ${numberExpression(sequence, "o.osl_count")} FROM (SELECT ${keys.join(", ")}, row_number() OVER (${partition}ORDER BY ${first}${keys.join(", ")}) AS osl_count FROM ${table}) AS o WHERE ${match};`;
}

/**
 * The statements that set a sequence's counters from the rows that exist: each scope's counter to the largest
 * number its rows carry (the digits a number ends in), so the next create counts on from there.
 */
export function seedSequence(entity: EntityIR, sequence: SequenceIR): string[] {
  const table = quoteIdent(SEQUENCE_TABLE);
  const group = sequence.scope.length ? ` GROUP BY ${sequence.scope.map(c => `r.${quoteIdent(c)}`).join(", ")}` : "";
  const largest = `coalesce(max(substring(r.${quoteIdent(sequence.column)} from '([0-9]+)$')::bigint), 0)`;
  return [
    `DELETE FROM ${table} WHERE "sequence" = ${quoteLiteral(sequence.key)};`,
    `INSERT INTO ${table} ("sequence", "scope", "last") SELECT ${quoteLiteral(sequence.key)}, ${scopeExpression(sequence, "r")}, ${largest} FROM ${quoteIdent(entity.table)} AS r${group}${sequence.scope.length ? "" : " HAVING count(*) > 0"};`
  ];
}

/** Every object of the sequences in the order it is created; dropped in reverse. Empty without a sequence field. */
export function sequenceObjects(ir: IR): IsolationObject[] {
  if (!hasSequences(ir)) return [];
  const isolation = ir.auth?.tenancy?.isolation;
  const table = quoteIdent(SEQUENCE_TABLE);
  const out: IsolationObject[] = [
    {
      kind: "table",
      key: `table:${SEQUENCE_TABLE}`,
      name: SEQUENCE_TABLE,
      table: SEQUENCE_TABLE,
      // No grant follows, under isolation or without it: only the table's owner and the trigger functions reach it
      create: [
        `CREATE TABLE ${table} (\n  "sequence" text NOT NULL,\n  "scope" text NOT NULL,\n  "last" bigint NOT NULL,\n  PRIMARY KEY ("sequence", "scope")\n);`
      ],
      drop: [`DROP TABLE IF EXISTS ${table};`]
    }
  ];
  for (const entity of ir.entities)
    for (const sequence of entity.sequences ?? []) {
      const source = sequenceFunctionSource(sequence);
      const signature = `${quoteIdent(sequence.function)}()`;
      const create = [
        `CREATE FUNCTION ${signature} RETURNS trigger\nLANGUAGE plpgsql${isolation ? ` ${DEFINER}` : ""}\nAS $$\n${source}\n$$;`
      ];
      // Nobody calls a trigger function; under isolation nobody but its trigger may reach it at all
      if (isolation) create.push(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
      out.push(
        {
          kind: "function",
          key: `function:${sequence.function}`,
          name: sequence.function,
          create,
          drop: [`DROP FUNCTION IF EXISTS ${signature};`],
          body: { source, definer: Boolean(isolation) }
        },
        {
          kind: "trigger",
          key: `trigger:${entity.table}:${sequence.trigger}`,
          name: sequence.trigger,
          table: entity.table,
          create: [
            `CREATE TRIGGER ${quoteIdent(sequence.trigger)} BEFORE INSERT ON ${quoteIdent(entity.table)} FOR EACH ROW EXECUTE FUNCTION ${signature};`
          ],
          drop: [`DROP TRIGGER IF EXISTS ${quoteIdent(sequence.trigger)} ON ${quoteIdent(entity.table)};`],
          uses: [`function:${sequence.function}`]
        }
      );
    }
  return out;
}
