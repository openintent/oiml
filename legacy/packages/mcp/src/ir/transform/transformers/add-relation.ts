/**
 * Transformer for add_relation intent to AddRelationIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { AddRelation } from "@osl/schema/schemas/osl.intent/0.1.0/schema.zod.js";
import { AddRelationIRV1 } from "../../intents/add-relation.js";
import type { AddRelationIRV1 as AddRelationIRV1Type } from "../../intents/add-relation.js";
import { TransformContext, DiagnosticCollector } from "../types.js";
import { buildReferenceIR } from "../reference.js";

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

  const referenceType = buildReferenceIR(
    {
      source_entity: rel.source_entity,
      target_entity: rel.target_entity,
      kind: rel.kind,
      field_name: rel.field_name,
      foreign_key: rel.foreign_key,
      attributes: rel.attributes,
      reverse: rel.reverse
    },
    { path: "$.relation", diagnostics }
  );

  // Build the IR
  const ir: AddRelationIRV1Type = {
    kind: "AddRelation",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oslVersion,
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
