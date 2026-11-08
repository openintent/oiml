/**
 * Shared resolution of relations to ReferenceTypeIR.
 * Used by add_entity and add_field (relations declared on a field) and by add_relation.
 */

import type { ReferenceTypeIR } from "../types.js";
import type { DiagnosticCollector } from "./types.js";
import { toSnakeCase } from "./utils.js";

export type RelationKind = "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";

/** Relation as declared in an intent, normalized to always carry the source entity */
export interface RelationInput {
  source_entity: string;
  target_entity: string;
  kind: RelationKind;
  /** Relation name on the source side */
  field_name?: string;
  foreign_key?: { local_field: string; target_field: string; constraint_name?: string };
  attributes?: Array<{ name: string; args?: Record<string, unknown> }>;
  reverse?: { enabled?: boolean; field_name: string; kind?: RelationKind };
}

const INVERSE_KIND: Record<RelationKind, RelationKind> = {
  one_to_one: "one_to_one",
  many_to_one: "one_to_many",
  one_to_many: "many_to_one",
  many_to_many: "many_to_many"
};

const CARDINALITY: Record<RelationKind, "One" | "Many"> = {
  one_to_one: "One",
  many_to_one: "One",
  one_to_many: "Many",
  many_to_many: "Many"
};

/**
 * Resolve a relation to a fully explicit ReferenceTypeIR.
 *
 * - `nullable` comes from the caller when the relation sits on a field (the field's own
 *   nullability), otherwise from `nullable` / `optional` relation attributes.
 * - `onDelete` defaults to Restrict; the intent schema has no way to override it yet.
 * - `foreignKey.entity` says which table holds the column: the source for *_to_one,
 *   the target for one_to_many. many_to_many has no foreign key (it needs a junction table).
 */
export function buildReferenceIR(
  rel: RelationInput,
  options: { nullable?: boolean; path: string; diagnostics: DiagnosticCollector }
): ReferenceTypeIR {
  const { diagnostics, path } = options;

  const attributeNames = new Set((rel.attributes ?? []).map(a => a.name));
  const nullable = options.nullable ?? (attributeNames.has("nullable") || attributeNames.has("optional"));

  const reference: ReferenceTypeIR = {
    kind: "Reference",
    targetEntity: rel.target_entity,
    targetField: rel.foreign_key?.target_field ?? "id",
    cardinality: CARDINALITY[rel.kind],
    nullable,
    onDelete: "Restrict"
  };

  if (rel.field_name) {
    reference.relationName = rel.field_name;
  }

  if (rel.reverse) {
    reference.reverse = {
      enabled: rel.reverse.enabled !== false,
      fieldName: rel.reverse.field_name,
      cardinality: CARDINALITY[rel.reverse.kind ?? INVERSE_KIND[rel.kind]]
    };
  }

  if (rel.kind === "many_to_many") {
    diagnostics.info(
      "IR005",
      `many_to_many relation between '${rel.source_entity}' and '${rel.target_entity}' requires a junction table`,
      path
    );
    return reference;
  }

  const fkEntity = rel.kind === "one_to_many" ? rel.target_entity : rel.source_entity;

  if (rel.foreign_key) {
    reference.foreignKey = {
      entity: fkEntity,
      localField: rel.foreign_key.local_field,
      targetField: rel.foreign_key.target_field,
      ...(rel.foreign_key.constraint_name ? { constraintName: rel.foreign_key.constraint_name } : {})
    };
  } else {
    // Only one_to_many can omit foreign_key (the intent schema requires it for *_to_one)
    const localField = `${toSnakeCase(rel.source_entity)}_id`;
    reference.foreignKey = { entity: fkEntity, localField, targetField: "id" };
    diagnostics.info(
      "IR004",
      `Inferred foreign key '${fkEntity}.${localField}' referencing '${rel.source_entity}.id'`,
      path
    );
  }

  return reference;
}

/** Relation name for a foreign key field: "author_id" becomes "author" */
export function relationNameFromForeignKey(fieldName: string): string | undefined {
  return fieldName.endsWith("_id") && fieldName.length > 3 ? fieldName.slice(0, -3) : undefined;
}
