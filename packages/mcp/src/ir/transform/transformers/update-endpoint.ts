/**
 * Transformer for update_endpoint intent to UpdateEndpointIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { UpdateEndpoint } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import { UpdateEndpointIRV1 } from "../../intents/update-endpoint.js";
import type { UpdateEndpointIRV1 as UpdateEndpointIRV1Type } from "../../intents/update-endpoint.js";
import { TransformContext, DiagnosticCollector } from "../types.js";

/** Type alias for the update_endpoint intent input */
export type UpdateEndpointIntent = z.infer<typeof UpdateEndpoint>;

/**
 * Transform an update_endpoint intent to IR
 *
 * @param intent - The parsed update_endpoint intent
 * @param context - Transformation context
 * @returns Validated UpdateEndpointIRV1 IR
 */
export function transformUpdateEndpoint(
  intent: UpdateEndpointIntent,
  context: TransformContext
): UpdateEndpointIRV1Type {
  const diagnostics = new DiagnosticCollector();

  // Build updates IR
  const updates: any = {};

  // Transform add_field updates
  if (intent.updates.add_field) {
    const addFields: any[] = [];

    for (const fieldUpdate of intent.updates.add_field) {
      const source = fieldUpdate.source;
      let sourceIR: any;

      // Map source type
      if (source.type === "relation") {
        sourceIR = {
          type: "relation",
          relation: source.relation!,
          field: source.field
        };
      } else if (source.type === "field") {
        sourceIR = {
          type: "field",
          entity: source.entity!,
          field: source.field!
        };
      } else if (source.type === "computed") {
        sourceIR = {
          type: "computed",
          expression: source.expression || ""
        };
      } else if (source.join) {
        // Handle join source
        sourceIR = {
          type: "join",
          foreignKey: source.join.foreign_key,
          targetEntity: source.join.target_entity,
          targetField: source.join.target_field
        };
      }

      if (sourceIR) {
        addFields.push({
          name: fieldUpdate.name,
          source: sourceIR
        });
      }
    }

    if (addFields.length > 0) {
      updates.addFields = addFields;
    }
  }

  // Build the IR
  const ir: UpdateEndpointIRV1Type = {
    kind: "UpdateEndpoint",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oimlVersion,
      model: context.model
    },
    method: intent.method,
    path: intent.path,
    updates,
    diagnostics: diagnostics.getDiagnostics()
  };

  // Validate the IR with Zod
  const validationResult = UpdateEndpointIRV1.safeParse(ir);

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
