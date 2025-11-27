/**
 * Transformer for add_field intent to AddFieldIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { AddField } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import { AddFieldIRV1 } from "../../intents/add-field.js";
import type { AddFieldIRV1 as AddFieldIRV1Type } from "../../intents/add-field.js";
import type { FieldIRV1 as FieldIRV1Type } from "../../field.js";
import { TransformContext, DiagnosticCollector } from "../types.js";
import { resolveFieldType, generateEnumName, isReservedKeyword } from "../utils.js";

/** Type alias for the add_field intent input */
export type AddFieldIntent = z.infer<typeof AddField>;

/**
 * Transform an add_field intent to IR
 *
 * @param intent - The parsed add_field intent
 * @param context - Transformation context
 * @returns Validated AddFieldIRV1 IR
 */
export function transformAddField(intent: AddFieldIntent, context: TransformContext): AddFieldIRV1Type {
  const diagnostics = new DiagnosticCollector();

  // Validate entity exists (if context provides existing entities)
  if (context.existingEntities && !context.existingEntities.includes(intent.entity)) {
    diagnostics.error("IR030", `Entity '${intent.entity}' does not exist`, "$.entity");
  }

  // Transform fields
  const fields: FieldIRV1Type[] = [];
  const fieldNames = new Set<string>();

  for (let i = 0; i < intent.fields.length; i++) {
    const field = intent.fields[i];
    const fieldPath = `$.fields[${i}]`;

    // Check for duplicate field names
    if (fieldNames.has(field.name)) {
      diagnostics.error("IR020", `Duplicate field name '${field.name}'`, `${fieldPath}.name`);
      continue;
    }
    fieldNames.add(field.name);

    // Check for reserved keywords
    if (isReservedKeyword(field.name)) {
      diagnostics.warn("IR011", `Field name '${field.name}' is a reserved SQL keyword`, `${fieldPath}.name`);
    }

    // Resolve field type
    let fieldType;
    try {
      fieldType = resolveFieldType(field.type, field.enum_values, field.array_type);

      // Generate enum name if needed
      if (fieldType.kind === "Enum" && !fieldType.name) {
        fieldType.name = generateEnumName(intent.entity, field.name);
      }
    } catch (error) {
      diagnostics.error(
        "IR021",
        `Invalid field type '${field.type}' for field '${field.name}': ${error}`,
        `${fieldPath}.type`
      );
      continue;
    }

    // Resolve nullable (opposite of required, default to nullable if not specified)
    const nullable = field.required !== true;

    // Build field IR
    const irField: any = {
      name: field.name,
      type: fieldType,
      nullable
    };

    // Add unique constraint
    if (field.unique) {
      irField.unique = true;
    }

    // Add default value
    if (field.default) {
      if (field.default === "now" || field.default === "current_timestamp") {
        irField.default = { kind: "Now" as const };
      } else if (field.default === "autoincrement") {
        irField.default = { kind: "AutoIncrement" as const };
      } else if (
        typeof field.default === "string" ||
        typeof field.default === "number" ||
        typeof field.default === "boolean"
      ) {
        irField.default = { kind: "Literal" as const, value: field.default };
      }
    }

    // Add validations
    const validations: any[] = [];
    if (field.max_length) {
      validations.push({ kind: "MaxLength" as const, max: field.max_length });
    }
    if (field.min_length) {
      validations.push({ kind: "MinLength" as const, min: field.min_length });
    }
    if (field.pattern) {
      validations.push({ kind: "Pattern" as const, regex: field.pattern });
    }
    if (validations.length > 0) {
      irField.validations = validations;
    }

    // Add API configuration
    if (field.api) {
      irField.api = {
        include: field.api.include,
        endpoints: field.api.endpoints
      };
    }

    // Add description and tags
    if (field.description) {
      irField.description = field.description;
    }
    if (field.tags && field.tags.length > 0) {
      irField.tags = field.tags;
    }

    fields.push(irField as FieldIRV1Type);
  }

  // Build the IR
  const ir: AddFieldIRV1Type = {
    kind: "AddField",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oimlVersion,
      model: context.model
    },
    entityName: intent.entity,
    fields,
    diagnostics: diagnostics.getDiagnostics()
  };

  // Validate the IR with Zod
  const validationResult = AddFieldIRV1.safeParse(ir);

  if (!validationResult.success) {
    // Add validation errors to diagnostics
    validationResult.error.issues.forEach(issue => {
      diagnostics.error("IR099", `IR validation failed: ${issue.message}`, issue.path.join("."));
    });

    // If there are errors, throw
    if (diagnostics.hasErrors()) {
      const error = new Error("IR transformation failed with validation errors");
      (error as any).diagnostics = diagnostics.getDiagnostics();
      throw error;
    }
  }

  return validationResult.success ? validationResult.data : ir;
}
