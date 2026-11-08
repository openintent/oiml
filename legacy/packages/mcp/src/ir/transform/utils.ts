/**
 * Utility functions for intent-to-IR transformation
 */

import { FieldTypeIR, ScalarTypeIR, EnumTypeIR, ArrayTypeIR, JsonTypeIR } from "../types.js";

/**
 * Convert human-authored field type string to IR FieldTypeIR
 */
export function resolveFieldType(intentType: string, enumValues?: string[], arrayType?: string): FieldTypeIR {
  switch (intentType) {
    case "string":
      return { kind: "Scalar", scalar: "String" };
    case "text":
      return { kind: "Scalar", scalar: "Text" };
    case "integer":
      return { kind: "Scalar", scalar: "Int" };
    case "bigint":
      return { kind: "Scalar", scalar: "BigInt" };
    case "float":
      return { kind: "Scalar", scalar: "Float" };
    case "decimal":
      return { kind: "Scalar", scalar: "Decimal" };
    case "boolean":
      return { kind: "Scalar", scalar: "Boolean" };
    case "datetime":
      return { kind: "Scalar", scalar: "DateTime" };
    case "date":
      return { kind: "Scalar", scalar: "Date" };
    case "time":
      return { kind: "Scalar", scalar: "Time" };
    case "uuid":
      return { kind: "Scalar", scalar: "UUID" };
    case "bytes":
      return { kind: "Scalar", scalar: "Bytes" };
    case "json":
      return { kind: "Json" };
    case "enum": {
      if (!enumValues || enumValues.length === 0) {
        throw new Error("Enum type requires enum_values");
      }
      return {
        kind: "Enum",
        name: "", // Will be inferred from context (entity + field name)
        values: enumValues,
        source: "Inline"
      };
    }
    case "array": {
      if (!arrayType) {
        throw new Error("Array type requires array_type");
      }
      return {
        kind: "Array",
        elementType: resolveArrayElementType(arrayType)
      };
    }
    default:
      throw new Error(`Unknown field type: ${intentType}`);
  }
}

/**
 * Resolve array element type
 */
function resolveArrayElementType(
  arrayType: string
): "String" | "Text" | "Int" | "BigInt" | "Float" | "Decimal" | "Boolean" | "UUID" {
  switch (arrayType) {
    case "string":
      return "String";
    case "text":
      return "Text";
    case "integer":
      return "Int";
    case "bigint":
      return "BigInt";
    case "float":
      return "Float";
    case "decimal":
      return "Decimal";
    case "boolean":
      return "Boolean";
    case "uuid":
      return "UUID";
    default:
      throw new Error(`Invalid array element type: ${arrayType}`);
  }
}

/**
 * Convert entity name to table name using specified convention
 */
export function toTableName(
  entityName: string,
  convention: "snake_case" | "camelCase" | "PascalCase" = "snake_case"
): string {
  switch (convention) {
    case "snake_case":
      return toSnakeCase(pluralize(entityName));
    case "camelCase":
      return toCamelCase(pluralize(entityName));
    case "PascalCase":
      return toPascalCase(pluralize(entityName));
  }
}

/**
 * Convert string to snake_case
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

/**
 * Convert string to camelCase
 */
export function toCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/**
 * Convert string to PascalCase
 */
export function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Simple pluralization (English only, basic rules)
 */
export function pluralize(word: string): string {
  // Handle irregular plurals
  const irregulars: Record<string, string> = {
    person: "people",
    child: "children",
    man: "men",
    woman: "women",
    tooth: "teeth",
    foot: "feet",
    mouse: "mice",
    goose: "geese"
  };

  const lower = word.toLowerCase();
  if (irregulars[lower]) {
    return word.charAt(0) === word.charAt(0).toUpperCase()
      ? irregulars[lower].charAt(0).toUpperCase() + irregulars[lower].slice(1)
      : irregulars[lower];
  }

  // Handle words ending in 'y'
  if (word.endsWith("y") && !["a", "e", "i", "o", "u"].includes(word.charAt(word.length - 2))) {
    return word.slice(0, -1) + "ies";
  }

  // Handle words ending in 's', 'x', 'z', 'ch', 'sh'
  if (word.match(/(s|x|z|ch|sh)$/)) {
    return word + "es";
  }

  // Default: add 's'
  return word + "s";
}

/**
 * Generate enum type name from entity and field names
 */
export function generateEnumName(entityName: string, fieldName: string): string {
  return `${entityName}${toPascalCase(fieldName)}`;
}

/**
 * Check if a name is a reserved SQL keyword
 */
export function isReservedKeyword(name: string): boolean {
  const reserved = [
    "select",
    "from",
    "where",
    "insert",
    "update",
    "delete",
    "table",
    "column",
    "index",
    "key",
    "primary",
    "foreign",
    "constraint",
    "default",
    "null",
    "not",
    "and",
    "or",
    "order",
    "group",
    "by",
    "having",
    "join",
    "inner",
    "outer",
    "left",
    "right",
    "cross",
    "union",
    "distinct",
    "as",
    "on",
    "using",
    "limit",
    "offset"
  ];
  return reserved.includes(name.toLowerCase());
}
