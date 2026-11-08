/** Naming helpers shared by the compiler and every backend. All are pure. */

const IRREGULAR_PLURALS: Record<string, string> = {
  person: "people",
  child: "children",
  man: "men",
  woman: "women",
  tooth: "teeth",
  foot: "feet",
  mouse: "mice",
  goose: "geese"
};

export function pluralize(word: string): string {
  const lower = word.toLowerCase();
  const irregular = IRREGULAR_PLURALS[lower];
  if (irregular) return word[0] === word[0].toUpperCase() ? irregular[0].toUpperCase() + irregular.slice(1) : irregular;
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  if (/fe$/i.test(word)) return word.slice(0, -2) + "ves";
  if (/[^f]f$/i.test(word)) return word.slice(0, -1) + "ves";
  return word + "s";
}

export function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export function toCamelCase(input: string): string {
  const pascal = toPascalCase(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toPascalCase(input: string): string {
  return input
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function toKebabCase(input: string): string {
  return toSnakeCase(input).replace(/_/g, "-");
}

/** Default SQL table name for an entity: snake_case and plural. `BlogPost` becomes `blog_posts`. */
export function defaultTableName(entityName: string): string {
  return pluralize(toSnakeCase(entityName));
}

/** Relation name implied by a foreign key column: `author_id` becomes `author`. */
export function relationNameFromColumn(column: string): string {
  return column.endsWith("_id") && column.length > 3 ? column.slice(0, -3) : column;
}

/** A safe slug for file names and migration names. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/** snake_case or kebab-case to Title Case: `blog_posts` -> `Blog Posts` */
export function toTitleCase(input: string): string {
  return input
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
