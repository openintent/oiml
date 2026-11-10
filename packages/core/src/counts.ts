/**
 * The database side of a count (`count_of` on an integer field): the trigger function and the triggers that keep
 * the number, as a pure function of the IR. Migrations create and drop them with the isolation layer's objects and
 * the ordered collections', and the drift check compares them with the live database.
 *
 * The count lives in the database so that every writer keeps it, whatever code it is: a generated handler, an
 * action handler of the user's, a seed, a cascade, a TRUNCATE.
 *
 * - One function per count field, and four statement triggers on the counted table (insert, delete, update,
 *   truncate). A statement's rows come as transition tables, so the function adds up what the statement did per
 *   parent and writes each parent once, parents in key order: two statements that touch the same parents ask for
 *   their rows in the same order.
 * - The write is `count = count + n` on the counting row, which waits for that row like any update of it. That
 *   wait is what makes the number exact: whoever commits second adds to what the first one left.
 * - Where the counted rows are ordered within the relation they are counted by (`position: { within }`, order.ts),
 *   the counting row is also the order's lock. The order's own writers take it before any row of the parent, a
 *   count takes it after the row that changed, and a transaction that had appended to a parent and then moved in
 *   it could wait for a row whose writer waits for the count. So there an append takes the parent the way a move
 *   does (the parent, then every row of it without waiting), after the rows its foreign keys point at: whoever
 *   holds the parent holds its rows too, and a count never waits for a parent whose rows are half taken.
 *
 * Under `isolation: database` the functions run with their owner's rights. A count is a fact about the counting
 * row, whoever wrote the counted one: a row of a shared table that points at a tenant's row is written by callers
 * who are not bound to that tenant, and under the caller's rights the policy would hide the row the count sits on
 * and the number would be wrong without a word. The functions read nothing and return nothing; they add to the
 * count of exactly the rows the statement's own rows point at.
 */
import type { CountIR, EntityIR, IR, RuleConditionIR } from "./ir.js";
import { sqlName } from "./ir.js";
import { isolationObjects, type IsolationObject } from "./isolation.js";
import { quoteIdent, quoteLiteral } from "./migrations.js";
import { orderObjects } from "./order.js";
import { sequenceObjects } from "./sequences.js";

const DEFINER = "SECURITY DEFINER SET search_path = public, pg_temp";

/** The comparison a count's condition makes on a column of `alias`: a null literal tests for null, `!=` also holds for null */
function comparison(alias: string, when: RuleConditionIR): string {
  const expression = `${alias ? `${alias}.` : ""}${quoteIdent(when.column)}`;
  if (when.value === null) return `${expression} IS ${when.op === "eq" ? "" : "NOT "}NULL`;
  return `${expression} ${when.op === "eq" ? "=" : "IS DISTINCT FROM"} ${quoteLiteral(when.value)}`;
}

/** ` AND <conditions>` over the rows of `alias`, or nothing when the count takes every row */
function conditions(count: CountIR, alias: string): string {
  return count.where.map(when => ` AND ${comparison(alias, when)}`).join("");
}

/** The statement that sets a count from the rows that exist: what a migration runs when the field arrives or its meaning changes */
export function backfillCount(entity: EntityIR, count: CountIR): string {
  return `UPDATE ${quoteIdent(entity.table)} AS p SET ${quoteIdent(count.column)} = (SELECT count(*) FROM ${quoteIdent(count.table)} AS c WHERE c.${quoteIdent(count.fk)} = p.${quoteIdent(count.key)}${conditions(count, "c")});`;
}

/** The body of a count's trigger function */
export function countFunctionSource(entity: EntityIR, count: CountIR): string {
  const table = quoteIdent(entity.table);
  const column = quoteIdent(count.column);
  const key = quoteIdent(count.key);
  const fk = quoteIdent(count.fk);
  const write = `UPDATE ${table} SET ${column} = ${column} + osl_delta.n WHERE ${key} = osl_delta.parent;`;
  const only = count.where.length ? ` WHERE ${count.where.map(when => comparison("", when)).join(" AND ")}` : "";
  const rows = (from: string, sign: string) =>
    `SELECT ${fk} AS parent, ${sign}count(*)::integer AS n FROM ${from} WHERE ${fk} IS NOT NULL${conditions(count, "")} GROUP BY ${fk} ORDER BY ${fk}`;
  return [
    "DECLARE",
    "  osl_delta record;",
    "BEGIN",
    "  -- What the statement did to each parent's count, parent by parent in key order: every statement asks for the",
    "  -- rows it counts on in the same order, and each write waits for its row, so the number is exact",
    "  IF TG_OP = 'INSERT' THEN",
    `    FOR osl_delta IN ${rows("osl_new", "")} LOOP`,
    `      ${write}`,
    "    END LOOP;",
    "  ELSIF TG_OP = 'DELETE' THEN",
    `    FOR osl_delta IN ${rows("osl_old", "-")} LOOP`,
    `      ${write}`,
    "    END LOOP;",
    "  ELSIF TG_OP = 'UPDATE' THEN",
    "    -- A row that moved to another parent, or that the conditions hold for now and did not before (or the reverse)",
    "    FOR osl_delta IN",
    "      SELECT d.parent, sum(d.n)::integer AS n",
    `      FROM (SELECT ${fk} AS parent, 1 AS n FROM osl_new${only} UNION ALL SELECT ${fk} AS parent, -1 AS n FROM osl_old${only}) AS d`,
    "      WHERE d.parent IS NOT NULL GROUP BY d.parent HAVING sum(d.n) <> 0 ORDER BY d.parent",
    "    LOOP",
    `      ${write}`,
    "    END LOOP;",
    "  ELSE",
    "    -- TRUNCATE: no row is left to count",
    `    UPDATE ${table} SET ${column} = 0 WHERE ${column} <> 0;`,
    "  END IF;",
    "  RETURN NULL;",
    "END"
  ].join("\n");
}

/** The body of the function that takes an ordered parent before a counted row is added to it */
function holdFunctionSource(counted: EntityIR): string {
  const order = counted.order!;
  const lines = ["BEGIN"];
  const others = counted.foreignKeys.filter(fk => fk.column !== order.within);
  if (others.length)
    lines.push(
      "  -- The rows this one points at, as its foreign keys take them, before the parent: a delete of one of them is",
      "  -- waited for while nothing of the parent is held"
    );
  for (const fk of others)
    lines.push(
      `  PERFORM 1 FROM ${quoteIdent(fk.targetTable)} WHERE ${quoteIdent(fk.targetColumn)} = NEW.${quoteIdent(fk.column)} FOR KEY SHARE;`
    );
  lines.push(
    "  -- The parent and every row of it, as a move takes them: the count that follows writes the parent, and whoever",
    "  -- holds the parent then holds its rows too, so no count waits for a parent whose rows are half taken",
    `  PERFORM ${quoteIdent(sqlName(`osl_hold_${counted.table}`))}(NEW.${quoteIdent(order.within)});`,
    "  RETURN NEW;",
    "END"
  );
  return lines.join("\n");
}

/** Every object of the counts in the order it is created; dropped in reverse. Empty without a count_of field. */
export function countObjects(ir: IR): IsolationObject[] {
  const isolation = ir.auth?.tenancy?.isolation;
  const out: IsolationObject[] = [];
  const fn = (name: string, source: string): IsolationObject => {
    const signature = `${quoteIdent(name)}()`;
    const create = [
      `CREATE FUNCTION ${signature} RETURNS trigger\nLANGUAGE plpgsql${isolation ? ` ${DEFINER}` : ""}\nAS $$\n${source}\n$$;`
    ];
    // Nobody calls a trigger function; under isolation nobody but its trigger may reach it at all
    if (isolation) create.push(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
    return {
      kind: "function",
      key: `function:${name}`,
      name,
      create,
      drop: [`DROP FUNCTION IF EXISTS ${signature};`],
      body: { source, definer: Boolean(isolation) }
    };
  };
  const trigger = (
    table: string,
    name: string,
    when: string,
    each: string,
    uses: string,
    extra: string[] = []
  ): IsolationObject => ({
    kind: "trigger",
    key: `trigger:${table}:${name}`,
    name,
    table,
    create: [
      `CREATE TRIGGER ${quoteIdent(name)} ${when} ON ${quoteIdent(table)} ${each} EXECUTE FUNCTION ${quoteIdent(uses)}();`
    ],
    drop: [`DROP TRIGGER IF EXISTS ${quoteIdent(name)} ON ${quoteIdent(table)};`],
    uses: [`function:${uses}`, ...extra]
  });

  /** One hold per ordered table, however many counts ride on its order */
  const holds = new Map<string, EntityIR>();
  for (const entity of ir.entities)
    for (const count of entity.counts ?? []) {
      out.push(fn(count.function, countFunctionSource(entity, count)));
      const on = (suffix: string, when: string, tables: string) =>
        trigger(
          count.table,
          sqlName(`${count.trigger}_${suffix}`),
          when,
          `${tables}FOR EACH STATEMENT`,
          count.function
        );
      out.push(
        on("ins", "AFTER INSERT", "REFERENCING NEW TABLE AS osl_new "),
        on("del", "AFTER DELETE", "REFERENCING OLD TABLE AS osl_old "),
        on("upd", "AFTER UPDATE", "REFERENCING OLD TABLE AS osl_old NEW TABLE AS osl_new "),
        on("trn", "AFTER TRUNCATE", "")
      );
      if (count.hold) holds.set(count.hold, ir.entities.find(e => e.name === count.entity)!);
    }
  for (const [name, counted] of holds) {
    out.push(fn(name, holdFunctionSource(counted)));
    // By name it fires before the order's own trigger (osl_order_assign), which then finds the parent held
    out.push(
      trigger(counted.table, "osl_count_hold", "BEFORE INSERT", "FOR EACH ROW", name, [
        `function:${sqlName(`osl_hold_${counted.table}`)}`
      ])
    );
  }
  return out;
}

/**
 * Every database object a model implies beyond its tables, in the order it is created: the isolation layer, the
 * ordered collections, the counts, the sequences. One list, so that migrations plan them together and drift
 * compares them all.
 */
export function databaseObjects(ir: IR): IsolationObject[] {
  return [...isolationObjects(ir), ...orderObjects(ir), ...countObjects(ir), ...sequenceObjects(ir)];
}
