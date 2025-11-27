/**
 * Transformer for rename_field intent to RenameFieldIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { RenameField } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import { RenameFieldIRV1 } from "../../intents/rename-field.js";
import type { RenameFieldIRV1 as RenameFieldIRV1Type } from "../../intents/rename-field.js";
import { TransformContext, DiagnosticCollector } from "../types.js";
import { isReservedKeyword } from "../utils.js";

/** Type alias for the rename_field intent input */
export type RenameFieldIntent = z.infer<typeof RenameField>;

/**
 * Transform a rename_field intent to IR
 *
 * @param intent - The parsed rename_field intent
 * @param context - Transformation context
 * @returns Validated RenameFieldIRV1 IR
 */
export function transformRenameField(intent: RenameFieldIntent, context: TransformContext): RenameFieldIRV1Type {
  const diagnostics = new DiagnosticCollector();

  // Validate entity exists (if context provides existing entities)
  if (context.existingEntities && !context.existingEntities.includes(intent.entity)) {
    diagnostics.error("IR030", `Entity '${intent.entity}' does not exist`, "$.entity");
  }

  // Check if new name is a reserved keyword
  if (isReservedKeyword(intent.to)) {
    diagnostics.warn("IR011", `New field name '${intent.to}' is a reserved SQL keyword`, "$.to");
  }

  // Warn about potential reference updates
  diagnostics.info(
    "IR051",
    `Renaming field '${intent.from}' to '${intent.to}' in entity '${intent.entity}' - references will be updated automatically`,
    "$"
  );

  // Build the IR
  const ir: RenameFieldIRV1Type = {
    kind: "RenameField",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oimlVersion,
      model: context.model
    },
    entityName: intent.entity,
    fromName: intent.from,
    toName: intent.to,
    updateReferences: true, // Always update references for safety
    diagnostics: diagnostics.getDiagnostics()
  };

  // Validate the IR with Zod
  const validationResult = RenameFieldIRV1.safeParse(ir);

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
