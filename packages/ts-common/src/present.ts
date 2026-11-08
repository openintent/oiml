import type { IR } from "@osl/core";
import { isBytes, q, typeName, type TsConventions } from "./conventions.js";

/** generated/present.ts: public shapes of every entity, hidden columns removed, file snapshots given their URL. */
export function presentFile(ir: IR, conv: TsConventions): string {
  const out: string[] = [
    conv.header("Public shapes of each entity. Hidden columns never leave the server."),
    `import type * as schema from "./db/schema";`,
    ...(ir.files ? [`import { presentFileRef, type PublicFile } from "./files";`] : []),
    ""
  ];
  for (const entity of ir.entities) {
    const fields = entity.columns.filter(c => !c.hidden && !isBytes(c));
    const plain = fields.filter(c => c.type.kind !== "file");
    const files = fields.filter(c => c.type.kind === "file");
    const T = typeName(entity);
    const picked = `Pick<schema.${T}, ${plain.map(c => q(c.name)).join(" | ") || "never"}>`;
    const fileShape = files.length
      ? ` & { ${files.map(c => `${c.name}: PublicFile${c.nullable ? " | null" : ""}`).join("; ")} }`
      : "";
    out.push(`export type Public${T} = ${picked}${fileShape};`);
    out.push(`export function present${T}(row: schema.${T}): Public${T} {`);
    const parts = [
      ...plain.map(c => `${c.name}: row.${c.name}`),
      ...files.map(c =>
        c.nullable ? `${c.name}: presentFileRef(row.${c.name})` : `${c.name}: presentFileRef(row.${c.name})!`
      )
    ];
    out.push(`  return { ${parts.join(", ")} };`);
    out.push(`}`, "");
  }
  return out.join("\n");
}
