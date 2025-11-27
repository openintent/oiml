/**
 * Transformer for add_component intent to AddComponentIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { AddComponent } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import { AddComponentIRV1 } from "../../intents/add-component.js";
import type { AddComponentIRV1 as AddComponentIRV1Type } from "../../intents/add-component.js";
import { TransformContext, DiagnosticCollector } from "../types.js";

/** Type alias for the add_component intent input */
export type AddComponentIntent = z.infer<typeof AddComponent>;

/**
 * Transform an add_component intent to IR
 *
 * @param intent - The parsed add_component intent
 * @param context - Transformation context
 * @returns Validated AddComponentIRV1 IR
 */
export function transformAddComponent(intent: AddComponentIntent, context: TransformContext): AddComponentIRV1Type {
  const diagnostics = new DiagnosticCollector();

  // Validate entity exists (if specified)
  if (intent.entity && context.existingEntities && !context.existingEntities.includes(intent.entity)) {
    diagnostics.warn("IR030", `Entity '${intent.entity}' does not exist`, "$.entity");
  }

  // Build component IR
  const component: any = {
    name: intent.component,
    template: intent.template || "Custom"
  };

  if (intent.entity) {
    component.entity = intent.entity;
  }

  if (intent.display_fields) {
    component.displayFields = intent.display_fields;
  }

  if (intent.route) {
    component.route = intent.route;
  }

  // Build the IR
  const ir: AddComponentIRV1Type = {
    kind: "AddComponent",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oimlVersion,
      model: context.model
    },
    component,
    diagnostics: diagnostics.getDiagnostics()
  };

  // Validate the IR with Zod
  const validationResult = AddComponentIRV1.safeParse(ir);

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
