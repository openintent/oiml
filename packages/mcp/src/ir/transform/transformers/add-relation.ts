/**
 * Transformer for add_relation intent to AddRelationIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { AddRelation } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import { AddRelationIRV1 } from "../../intents/add-relation.js";
import type { AddRelationIRV1 as AddRelationIRV1Type } from "../../intents/add-relation.js";
import { TransformContext, DiagnosticCollector } from "../types.js";

/** Type alias for the add_relation intent input */
export type AddRelationIntent = z.infer<typeof AddRelation>;

/**
 * Transform an add_relation intent to IR
 *
 * @param intent - The parsed add_relation intent
 * @param context - Transformation context
 * @returns Validated AddRelationIRV1 IR
 */
export function transformAddRelation(intent: AddRelationIntent, context: TransformContext): AddRelationIRV1Type {
  const diagnostics = new DiagnosticCollector();

  const rel = intent.relation;

  // Validate source entity exists
  if (context.existingEntities && !context.existingEntities.includes(rel.source_entity)) {
    diagnostics.error("IR030", `Source entity '${rel.source_entity}' does not exist`, "$.relation.source_entity");
  }

  // Validate target entity exists
  if (context.existingEntities && !context.existingEntities.includes(rel.target_entity)) {
    diagnostics.error("IR030", `Target entity '${rel.target_entity}' does not exist`, "$.relation.target_entity");
  }

  // Map relation kind to cardinality
  const cardinalityMap: Record<string, "One" | "Many"> = {
    one_to_one: "One",
    many_to_one: "One",
    one_to_many: "Many",
    many_to_many: "Many"
  };

  const cardinality = cardinalityMap[rel.kind] || "One";

  // Determine nullable based on required (if specified via foreign_key)
  const nullable = rel.foreign_key?.required === false;

  // Build reference type IR
  const referenceType: any = {
    kind: "Reference",
    targetEntity: rel.target_entity,
    targetField: rel.foreign_key?.target_field || "id",
    cardinality,
    nullable
  };

  // Add relation name if specified
  if (rel.field_name) {
    referenceType.relationName = rel.field_name;
  }

  // Add onDelete behavior if specified
  if (rel.attributes) {
    const onDeleteAttr = rel.attributes.find((a: any) => a.name === "on_delete");
    if (onDeleteAttr) {
      referenceType.onDelete = onDeleteAttr.args?.action || "Restrict";
    }
  }

  // Add reverse relation if specified
  if (rel.reverse) {
    const reverseCardinality = rel.reverse.kind === "one_to_many" ? "Many" : "One";
    referenceType.reverse = {
      enabled: rel.reverse.enabled !== false,
      fieldName: rel.reverse.field_name,
      cardinality: reverseCardinality
    };
  }

  // Build the IR
  const ir: AddRelationIRV1Type = {
    kind: "AddRelation",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oimlVersion,
      model: context.model
    },
    relation: {
      sourceEntity: rel.source_entity,
      targetEntity: rel.target_entity,
      fieldName: rel.field_name,
      type: referenceType,
      emitMigration: rel.emit_migration !== false
    },
    diagnostics: diagnostics.getDiagnostics()
  };

  // Validate the IR with Zod
  const validationResult = AddRelationIRV1.safeParse(ir);

  if (!validationResult.success) {
    validationResult.error.issues.forEach(issue => {
      diagnostics.error("IR099", `IR validation failed: ${issue.message}`, issue.path.join("."));
    });

    if (diagnostics.hasErrors()) {
      const error = new Error("IR transformation failed with validation errors");
      (error as any).diagnostics = diagnostics.getDiagnostics();
      throw error;
    }
  }

  return validationResult.success ? validationResult.data : ir;
}
