/**
 * What the TypeScript resource modules share for the two constructs of round B2: relations through a junction (the
 * far rows an include returns) and ordered collections (the order of a reverse include, `move`, and a delete that
 * closes its gap). Both backends write the same Drizzle statements; only where the module sits differs.
 */
import { toPascalCase, type ActionIR, type EntityIR, type IR, type ThroughIR } from "@osl/core";
import { entityByName, q, singlePrimaryKey, typeName } from "./conventions.js";
import { presentMapper } from "./present.js";

type TableVar = (entity: EntityIR) => string;

function keyTs(entity: EntityIR): string {
  const pk = singlePrimaryKey(entity);
  return pk.type.kind === "scalar" && (pk.type.scalar === "integer" || pk.type.scalar === "bigint")
    ? "number"
    : "string";
}

/** The `with` clause of a relational query: every included relation, a reverse one to an ordered entity in its order */
export function withClause(entity: EntityIR, include: string[]): string {
  if (!include.length) return "";
  const parts = include.map(name => {
    const rel = entity.relations.find(r => r.name === name);
    return rel?.orderBy ? `${name}: { orderBy: (row, { asc }) => [asc(row.${rel.orderBy})] }` : `${name}: true`;
  });
  return `, with: { ${parts.join(", ")} }`;
}

/** The relations through a junction an operation includes */
export function throughOf(entity: EntityIR, names: string[] | undefined): ThroughIR[] {
  return (names ?? []).map(name => entity.through!.find(t => t.name === name)!);
}

export interface ThroughSource {
  /** Module-level functions: one loader per relation, one `attach` per operation that includes any */
  sections: string[];
  /** Entities whose tables the loaders read */
  tables: string[];
  drizzle: string[];
  /** Presenters of the far rows */
  presents: string[];
  /** Wraps the list's rows expression (an array) into the rows with their far rows; identity without any */
  list: (rows: string) => string;
  /** Wraps the get's row expression into the row with its far rows; identity without any */
  get: (row: string) => string;
}

/**
 * The loaders of the relations through a junction that a resource's list and get include. A loader makes one
 * statement for a page of rows: the junction joined to the far table, in the junction's order when it has one and
 * by the far rows' display column otherwise. A far row is not tested against its own read rule, like every include.
 */
export function throughSource(
  ir: IR,
  entity: EntityIR,
  listNames: string[] | undefined,
  getNames: string[] | undefined,
  tableVar: TableVar
): ThroughSource {
  const listRels = throughOf(entity, listNames);
  const getRels = throughOf(entity, getNames);
  const all = [...new Map([...listRels, ...getRels].map(t => [t.name, t])).values()];
  const none: ThroughSource = { sections: [], tables: [], drizzle: [], presents: [], list: r => r, get: r => r };
  if (!all.length) return none;
  const pk = singlePrimaryKey(entity).name;
  const key = keyTs(entity);
  const sections: string[] = [];
  const tables = new Set<string>();
  const presents = new Set<string>();
  for (const rel of all) {
    const junction = entityByName(ir, rel.junction);
    const far = entityByName(ir, rel.target);
    tables.add(junction.name);
    tables.add(far.name);
    presents.add(`present${typeName(far)}`);
    const j = tableVar(junction);
    const f = tableVar(far);
    const order = rel.orderBy
      ? `asc(${j}.${rel.orderBy})`
      : `asc(${f}.${far.display})${far.display === rel.targetColumn ? "" : `, asc(${f}.${rel.targetColumn})`}`;
    sections.push(`/** The ${rel.name} of each row: the ${far.name} rows ${rel.junction} links it to, ${rel.orderBy ? `in the order of ${rel.junction}.${rel.orderBy}` : `by ${far.display}`} */
async function load${toPascalCase(rel.name)}(ids: ${key}[]): Promise<Map<${key}, schema.${typeName(far)}[]>> {
  const out = new Map<${key}, schema.${typeName(far)}[]>();
  if (ids.length === 0) return out;
  const links = await db
    .select({ key: ${j}.${rel.from}, row: ${f} })
    .from(${j})
    .innerJoin(${f}, eq(${j}.${rel.to}, ${f}.${rel.targetColumn}))
    .where(inArray(${j}.${rel.from}, ids))
    .orderBy(${order});
  for (const link of links) (out.get(link.key) ?? out.set(link.key, []).get(link.key)!).push(link.row);
  return out;
}`);
  }
  const attach = (name: "List" | "Get", rels: ThroughIR[]) => {
    if (!rels.length) return;
    const omitted = rels.map(r => q(r.name)).join(" | ");
    sections.push(`/** The rows with the relations through a junction that ${name.toLowerCase()} includes, one statement per relation */
async function attach${name}(rows: Omit<${name}Row, ${omitted}>[]): Promise<${name}Row[]> {
  const ids = rows.map(row => row.${pk});
${rels.map(r => `  const ${r.name} = await load${toPascalCase(r.name)}(ids);`).join("\n")}
  return rows.map(row => ({ ...row, ${rels.map(r => `${r.name}: ${r.name}.get(row.${pk}) ?? []`).join(", ")} }));
}`);
  };
  attach("List", listRels);
  attach("Get", getRels);
  return {
    sections,
    tables: [...tables],
    drizzle: ["asc", "eq", "inArray"],
    presents: [...presents],
    list: rows => (listRels.length ? `(await attachList(${rows}))` : rows),
    get: row => (getRels.length ? `(await attachGet([${row}]))[0]` : row)
  };
}

/** The row type members and presenter entries of the relations through a junction, beside the included relations' */
export function throughRowParts(ir: IR, rels: ThroughIR[]): { types: string[]; presents: string[] } {
  return {
    types: rels.map(r => `${r.name}: schema.${typeName(entityByName(ir, r.target))}[]`),
    presents: rels.map(r => `${r.name}: row.${r.name}.map(${presentMapper(entityByName(ir, r.target), "viewer")})`)
  };
}

/** The statement that deletes a row of an ordered entity: the database's own, which closes the gap under the parent's lock */
export function removeStatement(entity: EntityIR, id: string): string | null {
  return entity.order ? `await db.execute(sql\`select "${entity.order.remove}"(\${${id}})\`);` : null;
}

/**
 * The module-level function behind the compiler's `move` action: the database puts the row at its new place and
 * renumbers its parent in one statement, and the row is read again as it now is (undefined when it went meanwhile).
 */
export function moveSource(entity: EntityIR, table: string, query: string): string {
  const order = entity.order!;
  const T = typeName(entity);
  const pk = singlePrimaryKey(entity).name;
  return `/** move: place \`to\` among the rows of its ${order.within}, the last place when \`to\` is beyond it; the database renumbers the others */
async function moveRow(row: schema.${T}, to: number): Promise<schema.${T} | undefined> {
  await db.execute(sql\`select "${order.move}"(\${row.${pk}}, \${to})\`);
  return ${query}.findFirst({ where: eq(${table}.${pk}, row.${pk}) });
}`;
}

/** Whether an action is the compiler's own `move` */
export function isMove(action: ActionIR): boolean {
  return action.builtin === "move";
}
