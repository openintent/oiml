/**
 * The database side of an ordered collection (a `position` field): every object that keeps a parent's rows in
 * order, as a pure function of the IR. Migrations create and drop them like the isolation layer's objects, and the
 * drift check compares the functions and triggers with the live database.
 *
 * The order lives in the database so that every writer keeps it, whatever code it is: a generated handler, an
 * action handler of the user's, a seed, a cascade.
 *
 * - UNIQUE (parent, position), deferrable: checked when a statement ends, so one statement may renumber a parent;
 * - a trigger that appends every new row at the end of its parent;
 * - a trigger that closes the gap rows leave when a statement deletes them;
 * - `move(id, to)` and `remove(id)`, which the generated handlers call.
 *
 * One lock serializes the writers of one parent: the parent's row, taken FOR NO KEY UPDATE (it does not block the
 * key-share locks other tables' inserts take on the same parent). Append, move and remove wait for it before they
 * hold anything else. Past that point no writer waits for a row while it holds rows of the parent, which is what a
 * deadlock needs: move and remove take every row of the parent without waiting, and when one is held (an update in
 * flight, a cascade that has not committed) they give back what they took and ask again shortly; an append takes
 * none, since the checks of its own relations still follow. A delete that arrives another way (a cascade from the
 * far side of a junction, a handler's own DELETE) already holds its rows when the trigger runs, so there the parent
 * and its rows are taken only if they are free; otherwise the gap stays until the next move or remove in that
 * parent, which number it 1..n whatever they find. Places are therefore unique and in order at every moment, and
 * 1..n whenever nothing but appends, moves and removes wrote the parent, or after the first move or remove since.
 *
 * Under `isolation: database` the functions run with their owner's rights: the rows of one parent may belong
 * to several tenants (a junction ordered within a shared row), and a place is counted among all of them. `move` and
 * `remove` test the row they are given against the tenant policy's own expression before touching it, so the
 * backstop holds for them as it does for a plain statement.
 */
import type { EntityIR, IR } from "./ir.js";
import { tenantExpression, type IsolationObject } from "./isolation.js";
import { sqlName } from "./ir.js";
import { quoteIdent, sqlType } from "./migrations.js";

const DEFINER = "SECURITY DEFINER SET search_path = public, pg_temp";

/** How often a writer asks for the rows of a parent before it gives up with lock_not_available (about ten seconds) */
const HOLD_ATTEMPTS = 200;

/** The statement that numbers the rows of one parent 1..n in their current order; a no-op when they already are */
function renumber(entity: EntityIR, parent: string, indent: string): string[] {
  const order = entity.order!;
  const table = quoteIdent(entity.table);
  const key = quoteIdent(entity.primaryKey[0]);
  const position = quoteIdent(order.column);
  return [
    `UPDATE ${table} AS r SET ${position} = o.place`,
    `FROM (SELECT ${key} AS id, row_number() OVER (ORDER BY ${position}, ${key}) AS place FROM ${table} WHERE ${quoteIdent(order.within)} = ${parent}) AS o`,
    `WHERE r.${key} = o.id AND r.${position} <> o.place;`
  ].map(line => indent + line);
}

/** The statement that numbers the existing rows of a table that gains a position field, parent by parent */
export function backfillPositions(entity: EntityIR): string {
  const order = entity.order!;
  const table = quoteIdent(entity.table);
  const key = quoteIdent(entity.primaryKey[0]);
  const first = entity.columns.some(c => c.name === "created_at") ? `${quoteIdent("created_at")}, ` : "";
  return `UPDATE ${table} AS r SET ${quoteIdent(order.column)} = o.place FROM (SELECT ${key} AS id, row_number() OVER (PARTITION BY ${quoteIdent(order.within)} ORDER BY ${first}${key}) AS place FROM ${table}) AS o WHERE r.${key} = o.id;`;
}

/** Every object of the ordered collections in the order it is created; dropped in reverse. Empty without a position field. */
export function orderObjects(ir: IR): IsolationObject[] {
  const isolation = ir.auth?.tenancy?.isolation;
  const out: IsolationObject[] = [];
  for (const entity of ir.entities) {
    const order = entity.order;
    if (!order) continue;
    const table = quoteIdent(entity.table);
    const key = entity.columns.find(c => c.name === entity.primaryKey[0])!;
    const keyName = quoteIdent(key.name);
    const within = quoteIdent(order.within);
    const position = quoteIdent(order.column);
    const parentTable = quoteIdent(order.parentTable);
    const parentKey = quoteIdent(order.parentKey);
    const parentType = sqlType(entity.columns.find(c => c.name === order.within)!);
    // What the tenant policy tests, by hand: a definer function is not bound by the policy
    const guard = isolation && entity.tenant ? ` AND ${tenantExpression(isolation, entity.tenant.column)}` : "";

    out.push({
      kind: "constraint",
      key: `constraint:${entity.table}:${order.unique.name}`,
      name: order.unique.name,
      table: entity.table,
      create: [
        `ALTER TABLE ${table} ADD CONSTRAINT ${quoteIdent(order.unique.name)} UNIQUE (${order.unique.columns.map(quoteIdent).join(", ")}) DEFERRABLE INITIALLY IMMEDIATE;`
      ],
      drop: [`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${quoteIdent(order.unique.name)};`]
    });

    const fn = (name: string, args: string[], returns: string, body: string[], callable: boolean): IsolationObject => {
      const signature = `${quoteIdent(name)}(${args.join(", ")})`;
      const source = body.join("\n");
      const create = [
        `CREATE FUNCTION ${signature} RETURNS ${returns}\nLANGUAGE plpgsql${isolation ? ` ${DEFINER}` : ""}\nAS $$\n${source}\n$$;`
      ];
      if (isolation) {
        create.push(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
        if (callable) create.push(`GRANT EXECUTE ON FUNCTION ${signature} TO ${quoteIdent(isolation.appRole)};`);
      }
      return {
        kind: "function",
        key: `function:${name}`,
        name,
        create,
        drop: [
          `DROP FUNCTION IF EXISTS ${quoteIdent(name)}(${args.map(a => a.split(" ").slice(1).join(" ")).join(", ")});`
        ],
        body: { source, definer: Boolean(isolation) }
      };
    };

    const hold = sqlName(`osl_hold_${entity.table}`);
    out.push(
      fn(
        hold,
        [`osl_parent ${parentType}`],
        "void",
        [
          "DECLARE",
          "  osl_try integer := 0;",
          "BEGIN",
          "  LOOP",
          "    BEGIN",
          "      -- The parent first, and waited for: one writer at a time per parent",
          `      PERFORM 1 FROM ${parentTable} WHERE ${parentKey} = osl_parent FOR NO KEY UPDATE;`,
          "      -- Then every row of the parent, without waiting: a writer never waits for a row while it holds others",
          `      PERFORM 1 FROM ${table} WHERE ${within} = osl_parent FOR UPDATE NOWAIT;`,
          "      RETURN;",
          "    EXCEPTION WHEN lock_not_available THEN",
          "      -- Someone holds a row (an update in flight, a cascade): everything taken here is given back, and the",
          "      -- writer tries again shortly. Whoever held the row cannot have been waiting for this writer.",
          "      osl_try := osl_try + 1;",
          `      IF osl_try >= ${HOLD_ATTEMPTS} THEN RAISE; END IF;`,
          "    END;",
          "    PERFORM pg_sleep(0.005 * least(osl_try, 10));",
          "  END LOOP;",
          "END"
        ],
        false
      ),
      fn(
        order.assign,
        [],
        "trigger",
        [
          "BEGIN",
          "  -- One writer at a time per parent: the lock every append, move and remove of its rows waits for first",
          `  PERFORM 1 FROM ${parentTable} WHERE ${parentKey} = NEW.${within} FOR NO KEY UPDATE;`,
          "  -- After the last row, wherever that is. An append takes no other row of the parent: its own checks come",
          "  -- next (the rows it points at), and it must not hold what a delete of one of those rows is waiting for.",
          `  SELECT coalesce(max(${position}), 0) + 1 INTO NEW.${position} FROM ${table} WHERE ${within} = NEW.${within};`,
          "  RETURN NEW;",
          "END"
        ],
        false
      ),
      fn(
        order.close,
        [],
        "trigger",
        [
          "DECLARE",
          "  osl_parent record;",
          "BEGIN",
          `  FOR osl_parent IN SELECT DISTINCT ${within} AS id FROM osl_gone ORDER BY 1 LOOP`,
          "    -- The deleted rows are already held, so nothing is waited for here: the parent and its rows are taken",
          "    -- only if they are free. Otherwise the gap stays for the next writer of that parent, which closes it.",
          "    BEGIN",
          `      PERFORM 1 FROM ${parentTable} WHERE ${parentKey} = osl_parent.id FOR NO KEY UPDATE NOWAIT;`,
          `      PERFORM 1 FROM ${table} WHERE ${within} = osl_parent.id FOR UPDATE NOWAIT;`,
          ...renumber(entity, "osl_parent.id", "      "),
          "    EXCEPTION WHEN lock_not_available THEN NULL;",
          "    END;",
          "  END LOOP;",
          "  RETURN NULL;",
          "END"
        ],
        false
      ),
      fn(
        order.move,
        [`osl_row ${sqlType(key)}`, "osl_to integer"],
        "integer",
        [
          "DECLARE",
          `  osl_parent ${parentType};`,
          "  osl_count integer;",
          "  osl_place integer;",
          "BEGIN",
          `  SELECT ${within} INTO osl_parent FROM ${table} WHERE ${keyName} = osl_row${guard};`,
          "  IF NOT FOUND THEN RETURN NULL; END IF;",
          `  PERFORM ${quoteIdent(hold)}(osl_parent);`,
          `  SELECT count(*) INTO osl_count FROM ${table} WHERE ${within} = osl_parent;`,
          `  PERFORM 1 FROM ${table} WHERE ${keyName} = osl_row AND ${within} = osl_parent;`,
          "  IF NOT FOUND THEN RETURN NULL; END IF;",
          "  osl_place := greatest(1, least(osl_to, osl_count));",
          "  -- One statement: the others keep their order around the place the row takes, numbered 1..n",
          `  UPDATE ${table} AS r SET ${position} = o.place`,
          "  FROM (",
          "    SELECT s.id, CASE WHEN s.id = osl_row THEN osl_place WHEN s.rank >= osl_place THEN s.rank + 1 ELSE s.rank END AS place",
          `    FROM (SELECT ${keyName} AS id, row_number() OVER (ORDER BY (${keyName} = osl_row), ${position}, ${keyName}) AS rank FROM ${table} WHERE ${within} = osl_parent) AS s`,
          "  ) AS o",
          `  WHERE r.${keyName} = o.id AND r.${position} <> o.place;`,
          "  RETURN osl_place;",
          "END"
        ],
        true
      ),
      fn(
        order.remove,
        [`osl_row ${sqlType(key)}`],
        "boolean",
        [
          "DECLARE",
          `  osl_parent ${parentType};`,
          "BEGIN",
          `  SELECT ${within} INTO osl_parent FROM ${table} WHERE ${keyName} = osl_row${guard};`,
          "  IF NOT FOUND THEN RETURN false; END IF;",
          "  -- The parent and its rows first, then the delete: the trigger that follows finds them held and closes the gap",
          `  PERFORM ${quoteIdent(hold)}(osl_parent);`,
          `  DELETE FROM ${table} WHERE ${keyName} = osl_row;`,
          "  RETURN FOUND;",
          "END"
        ],
        true
      )
    );
    out.push(
      {
        kind: "trigger",
        key: `trigger:${entity.table}:osl_order_assign`,
        name: "osl_order_assign",
        table: entity.table,
        create: [
          `CREATE TRIGGER "osl_order_assign" BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${quoteIdent(order.assign)}();`
        ],
        drop: [`DROP TRIGGER IF EXISTS "osl_order_assign" ON ${table};`],
        uses: [`function:${order.assign}`]
      },
      {
        kind: "trigger",
        key: `trigger:${entity.table}:osl_order_close`,
        name: "osl_order_close",
        table: entity.table,
        create: [
          `CREATE TRIGGER "osl_order_close" AFTER DELETE ON ${table} REFERENCING OLD TABLE AS osl_gone FOR EACH STATEMENT EXECUTE FUNCTION ${quoteIdent(order.close)}();`
        ],
        drop: [`DROP TRIGGER IF EXISTS "osl_order_close" ON ${table};`],
        uses: [`function:${order.close}`]
      }
    );
  }
  return out;
}
