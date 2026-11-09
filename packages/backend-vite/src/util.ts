import type { ColumnIR, EntityIR, IR, PageIR, RuleIR } from "@osl/core";
import { toPascalCase, toSnakeCase, toTitleCase } from "@osl/core";
import { conventions, type ServerConventions } from "@osl/ts-common";

export {
  cap,
  column,
  entityByName,
  enumExport,
  indent,
  isBytes,
  q,
  relationsExport,
  singlePrimaryKey,
  tableExport,
  typeName
} from "@osl/ts-common";

/** `@/` is src (shadcn's Vite convention); the generated directory has its own alias. */
export const VITE = conventions("@osl/backend-hono-trpc-vite", { src: "@", generated: "@generated" });

/** The same conventions plus where the server modules live, for the shared server generators */
export const VITE_SERVER: ServerConventions = { ...VITE, errorsModule: "./server/errors", authModule: "./server/auth" };

export const HEADER = VITE.header;
export const SCAFFOLD_HEADER = VITE.scaffoldHeader;

/** lucide icon name in kebab-case to its PascalCase export: file-text -> FileText */
export function iconExport(kebab: string): string {
  return kebab
    .split("-")
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** TanStack flat route file base name for a path: /posts -> posts, /admin/users -> admin.users */
export function routeFileBase(path: string): string {
  return path.split("/").filter(Boolean).join(".");
}

/** Component name prefix of a page: posts -> Posts, blog_posts -> BlogPosts */
export function pageComponent(page: PageIR): string {
  return toPascalCase(page.name);
}

/** "Article" for an entity named Article; "Task Note" for TaskNote */
export function entityTitle(entity: EntityIR): string {
  return toTitleCase(toSnakeCase(entity.name));
}

export function identityPk(ir: IR): string {
  return ir.auth ? ir.entities.find(e => e.name === ir.auth!.identity)!.primaryKey[0] : "id";
}

export function isIntegerKey(column: ColumnIR): boolean {
  return column.type.kind === "scalar" && (column.type.scalar === "integer" || column.type.scalar === "bigint");
}

/** Loose Zod for an id as a client sends it; the strict check happens in parseId, so a bad id is a 404. */
export function idInputZod(pk: ColumnIR): string {
  return isIntegerKey(pk) ? "z.union([z.number().int(), z.string()])" : "z.string()";
}

/** A client-side predicate for a rule, over the signed-in user and (for row rules) the row. */
export function rulePredicate(rule: RuleIR, user: string, row: string | null, identityPkName: string): string {
  const base = basePredicate(rule, user, row, identityPkName);
  if (rule.kind === "any" || rule.kind === "all" || rule.kind === "none" || !rule.when || !row) return base;
  // A condition through a relation is decided by the API; the page offers the control when the base allows
  if (rule.when.via?.length) return base;
  // The condition is on the row the page shows; values compare as text, null only to null
  const col = `${row}.${rule.when.column}`;
  const test =
    rule.when.value === null
      ? `${col} ${rule.when.op === "eq" ? "==" : "!="} null`
      : `String(${col}) ${rule.when.op === "eq" ? "===" : "!=="} ${JSON.stringify(String(rule.when.value))}`;
  return `(${base} && ${test})`;
}

function basePredicate(rule: RuleIR, user: string, row: string | null, identityPkName: string): string {
  switch (rule.kind) {
    case "public":
      return "true";
    case "none":
      return "false";
    case "authenticated":
      return `${user} !== null`;
    case "owner":
      // A path is resolved by the API; the page only needs a signed-in user to offer the control
      return row && !rule.via
        ? `${user} !== null && ${row}.${rule.field} === ${user}.${identityPkName}`
        : `${user} !== null`;
    case "role":
      return `${user} !== null && (${user} as { role?: unknown }).role === ${JSON.stringify(rule.value)}`;
    case "member":
      // Membership is checked by the API; the page only needs a signed-in user to offer the control
      return `${user} !== null`;
    case "all": {
      const parts = [...new Set(rule.rules.map(r => rulePredicate(r, user, row, identityPkName)))];
      return parts.length === 1 ? parts[0] : `(${parts.join(" && ")})`;
    }
    case "any":
      return `(${rule.rules.map(r => rulePredicate(r, user, row, identityPkName)).join(" || ")})`;
  }
}

export function humanize(name: string): string {
  return toTitleCase(name.replace(/_id$/, ""));
}
