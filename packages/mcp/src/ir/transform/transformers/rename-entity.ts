/**
 * Transformer for rename_entity intent to RenameEntityIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { RenameEntity } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import { RenameEntityIRV1 } from "../../intents/rename-entity.js";
import type { RenameEntityIRV1 as RenameEntityIRV1Type } from "../../intents/rename-entity.js";
import { TransformContext, DiagnosticCollector } from "../types.js";
import { isReservedKeyword } from "../utils.js";

/** Type alias for the rename_entity intent input */
export type RenameEntityIntent = z.infer<typeof RenameEntity>;

/**
 * Transform a rename_entity intent to IR
 *
 * @param intent - The parsed rename_entity intent
 * @param context - Transformation context
 * @returns Validated RenameEntityIRV1 IR
 */
export function transformRenameEntity(intent: RenameEntityIntent, context: TransformContext): RenameEntityIRV1Type {
  const diagnostics = new DiagnosticCollector();

  // Validate source entity exists (if context provides existing entities)
  if (context.existingEntities && !context.existingEntities.includes(intent.from)) {
    diagnostics.error("IR030", `Entity '${intent.from}' does not exist`, "$.from");
  }

  // Validate target entity doesn't already exist
  if (context.existingEntities && context.existingEntities.includes(intent.to)) {
    diagnostics.error("IR031", `Entity '${intent.to}' already exists`, "$.to");
  }

  // Check if new name is a reserved keyword
  if (isReservedKeyword(intent.to)) {
    diagnostics.warn("IR011", `New entity name '${intent.to}' is a reserved SQL keyword`, "$.to");
  }

  // Warn about potential reference updates
  diagnostics.info(
    "IR050",
    `Renaming entity '${intent.from}' to '${intent.to}' - references will be updated automatically`,
    "$"
  );

  // Build the IR
  const ir: RenameEntityIRV1Type = {
    kind: "RenameEntity",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oimlVersion,
      model: context.model
    },
    fromName: intent.from,
    toName: intent.to,
    updateReferences: true, // Always update references for safety
    diagnostics: diagnostics.getDiagnostics()
  };

  // Validate the IR with Zod
  const validationResult = RenameEntityIRV1.safeParse(ir);

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
