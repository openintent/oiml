/**
 * Transformer for add_endpoint intent to AddEndpointIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { AddEndpoint } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import { AddEndpointIRV1 } from "../../intents/add-endpoint.js";
import type { AddEndpointIRV1 as AddEndpointIRV1Type } from "../../intents/add-endpoint.js";
import type { FieldIRV1 as FieldIRV1Type } from "../../field.js";
import { TransformContext, DiagnosticCollector } from "../types.js";
import { resolveFieldType, generateEnumName } from "../utils.js";

/** Type alias for the add_endpoint intent input */
export type AddEndpointIntent = z.infer<typeof AddEndpoint>;

/**
 * Transform an add_endpoint intent to IR
 *
 * @param intent - The parsed add_endpoint intent
 * @param context - Transformation context
 * @returns Validated AddEndpointIRV1 IR
 */
export function transformAddEndpoint(intent: AddEndpointIntent, context: TransformContext): AddEndpointIRV1Type {
  const diagnostics = new DiagnosticCollector();

  // Validate entity exists (if specified)
  if (intent.entity && context.existingEntities && !context.existingEntities.includes(intent.entity)) {
    diagnostics.warn("IR030", `Entity '${intent.entity}' does not exist`, "$.entity");
  }

  // Transform fields if provided
  const responseFields: FieldIRV1Type[] = [];
  if (intent.fields && intent.fields.length > 0) {
    for (let i = 0; i < intent.fields.length; i++) {
      const field = intent.fields[i];
      const fieldPath = `$.fields[${i}]`;

      try {
        const fieldType = resolveFieldType(field.type, field.enum_values, field.array_type);

        // Generate enum name if needed
        if (fieldType.kind === "Enum" && !fieldType.name) {
          fieldType.name = generateEnumName(intent.entity || "Response", field.name);
        }

        const nullable = field.required !== true;

        const irField: any = {
          name: field.name,
          type: fieldType,
          nullable
        };

        // Add validations
        const validations: any[] = [];
        if (field.max_length) {
          validations.push({
            kind: "MaxLength" as const,
            max: field.max_length
          });
        }
        if (validations.length > 0) {
          irField.validations = validations;
        }

        responseFields.push(irField as FieldIRV1Type);
      } catch (error) {
        diagnostics.error(
          "IR021",
          `Invalid field type '${field.type}' for field '${field.name}': ${error}`,
          `${fieldPath}.type`
        );
      }
    }
  }

  // Build endpoint IR
  const endpoint: any = {
    method: intent.method,
    path: intent.path
  };

  if (intent.description) {
    endpoint.description = intent.description;
  }

  if (intent.entity) {
    endpoint.entity = intent.entity;
  }

  if (responseFields.length > 0) {
    endpoint.responseFields = responseFields;
  }

  // Add authentication configuration
  if (intent.auth) {
    endpoint.auth = {
      required: intent.auth.required || false,
      roles: intent.auth.roles
    };
  }

  // Build the IR
  const ir: AddEndpointIRV1Type = {
    kind: "AddEndpoint",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oimlVersion,
      model: context.model
    },
    endpoint,
    diagnostics: diagnostics.getDiagnostics()
  };

  // Validate the IR with Zod
  const validationResult = AddEndpointIRV1.safeParse(ir);

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
