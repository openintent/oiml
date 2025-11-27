/**
 * Transformer for remove_entity intent to RemoveEntityIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { RemoveEntity } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import { RemoveEntityIRV1 } from "../../intents/remove-entity.js";
import type { RemoveEntityIRV1 as RemoveEntityIRV1Type } from "../../intents/remove-entity.js";
import { TransformContext, DiagnosticCollector } from "../types.js";

/** Type alias for the remove_entity intent input */
export type RemoveEntityIntent = z.infer<typeof RemoveEntity>;

/**
 * Transform a remove_entity intent to IR
 *
 * @param intent - The parsed remove_entity intent
 * @param context - Transformation context
 * @returns Validated RemoveEntityIRV1 IR
 */
export function transformRemoveEntity(intent: RemoveEntityIntent, context: TransformContext): RemoveEntityIRV1Type {
  const diagnostics = new DiagnosticCollector();

  // Validate entity exists (if context provides existing entities)
  if (context.existingEntities && !context.existingEntities.includes(intent.entity)) {
    diagnostics.error("IR030", `Entity '${intent.entity}' does not exist`, "$.entity");
  }

  // Warn if cascade is true
  if (intent.cascade) {
    diagnostics.warn(
      "IR041",
      `Cascade delete is enabled for entity '${intent.entity}' - related data will be deleted`,
      "$.cascade"
    );
  }

  // Build the IR
  const ir: RemoveEntityIRV1Type = {
    kind: "RemoveEntity",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oimlVersion,
      model: context.model
    },
    entityName: intent.entity,
    cascade: intent.cascade || false,
    diagnostics: diagnostics.getDiagnostics()
  };

  // Validate the IR with Zod
  const validationResult = RemoveEntityIRV1.safeParse(ir);

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
