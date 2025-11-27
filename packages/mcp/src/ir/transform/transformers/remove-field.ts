/**
 * Transformer for remove_field intent to RemoveFieldIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { RemoveField } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import { RemoveFieldIRV1 } from "../../intents/remove-field.js";
import type { RemoveFieldIRV1 as RemoveFieldIRV1Type } from "../../intents/remove-field.js";
import { TransformContext, DiagnosticCollector } from "../types.js";

/** Type alias for the remove_field intent input */
export type RemoveFieldIntent = z.infer<typeof RemoveField>;

/**
 * Transform a remove_field intent to IR
 *
 * @param intent - The parsed remove_field intent
 * @param context - Transformation context
 * @returns Validated RemoveFieldIRV1 IR
 */
export function transformRemoveField(intent: RemoveFieldIntent, context: TransformContext): RemoveFieldIRV1Type {
  const diagnostics = new DiagnosticCollector();

  // Validate entity exists (if context provides existing entities)
  if (context.existingEntities && !context.existingEntities.includes(intent.entity)) {
    diagnostics.error("IR030", `Entity '${intent.entity}' does not exist`, "$.entity");
  }

  // Check for duplicate field names
  const fieldNamesSet = new Set(intent.fields);
  if (fieldNamesSet.size !== intent.fields.length) {
    diagnostics.warn("IR040", "Duplicate field names in remove list", "$.fields");
  }

  // Build the IR
  const ir: RemoveFieldIRV1Type = {
    kind: "RemoveField",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oimlVersion,
      model: context.model
    },
    entityName: intent.entity,
    fieldNames: intent.fields,
    diagnostics: diagnostics.getDiagnostics()
  };

  // Validate the IR with Zod
  const validationResult = RemoveFieldIRV1.safeParse(ir);

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
