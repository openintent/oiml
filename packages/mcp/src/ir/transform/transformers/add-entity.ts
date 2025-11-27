/**
 * Transformer for add_entity intent to AddEntityIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { AddEntity } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import { AddEntityIRV1 } from "../../intents/add-entity.js";
import type { AddEntityIRV1 as AddEntityIRV1Type } from "../../intents/add-entity.js";
import type { FieldIRV1 as FieldIRV1Type } from "../../field.js";
import { TransformContext, DiagnosticCollector } from "../types.js";
import { resolveFieldType, toTableName, generateEnumName, isReservedKeyword } from "../utils.js";

/** Type alias for the add_entity intent input */
export type AddEntityIntent = z.infer<typeof AddEntity>;

/**
 * Transform an add_entity intent to IR
 *
 * @param intent - The parsed add_entity intent
 * @param context - Transformation context
 * @returns Validated AddEntityIRV1 IR
 */
export function transformAddEntity(intent: AddEntityIntent, context: TransformContext): AddEntityIRV1Type {
  const diagnostics = new DiagnosticCollector();

  // Validate entity name
  if (isReservedKeyword(intent.entity)) {
    diagnostics.warn("IR011", `Entity name '${intent.entity}' is a reserved SQL keyword`, "$.entity");
  }

  // Infer table name
  const tableName = toTableName(intent.entity, "snake_case");
  diagnostics.info("IR002", `Inferred table name '${tableName}'`, "$.entity");

  // Transform fields
  const fields: FieldIRV1Type[] = [];
  const fieldNames = new Set<string>();
  let primaryKeyField: string | null = null;

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

    // Check for primary key indicators
    const isPrimaryKey =
      field.name === "id" ||
      field.default === "autoincrement" ||
      (field.attributes && field.attributes.some((a: any) => a.name === "primary" || a.name === "id"));

    if (isPrimaryKey) {
      irField.isPrimary = true;
      irField.nullable = false; // Primary keys are never nullable

      if (!primaryKeyField) {
        primaryKeyField = field.name;
        diagnostics.info("IR001", `Inferred primary key '${field.name}'`, fieldPath);
      }

      // Add generated strategy
      if (field.default === "autoincrement" || field.type === "integer") {
        irField.generated = { strategy: "AutoIncrement" as const };
      } else if (field.type === "uuid") {
        irField.generated = { strategy: "UUID" as const };
      }
    }

    // Add default value
    if (field.default && field.default !== "autoincrement") {
      if (field.default === "now" || field.default === "current_timestamp") {
        irField.default = { kind: "Now" as const };
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

  // Ensure we have at least one primary key
  if (!primaryKeyField && fields.length > 0) {
    // Try to find an id field
    const idField = fields.find(f => f.name === "id");
    if (idField) {
      idField.isPrimary = true;
      idField.nullable = false;
      primaryKeyField = "id";
      diagnostics.info("IR001", "Inferred primary key 'id'", "$.fields");
    } else {
      diagnostics.error("IR020", "No primary key found or could be inferred", "$.fields");
    }
  }

  // Build constraints
  const constraints: any[] = [];

  // Add unique constraints
  if (intent.unique && Array.isArray(intent.unique)) {
    intent.unique.forEach((uniqueFields: string[], index: number) => {
      constraints.push({
        kind: "Unique" as const,
        fields: uniqueFields
      });
    });
  }

  // Add indexes
  if (intent.indexes && Array.isArray(intent.indexes)) {
    intent.indexes.forEach((index: any) => {
      constraints.push({
        kind: "Index" as const,
        name: index.name,
        fields: index.fields,
        unique: index.unique || false,
        type: index.type
      });
    });
  }

  // Auto-add indexes for foreign keys and unique fields
  fields.forEach(field => {
    if (field.type.kind === "Reference") {
      const hasIndex = constraints.some(c => c.kind === "Index" && c.fields.length === 1 && c.fields[0] === field.name);
      if (!hasIndex) {
        constraints.push({
          kind: "Index" as const,
          fields: [field.name]
        });
        diagnostics.info("IR003", `Auto-added index for foreign key '${field.name}'`, "$.fields");
      }
    }
  });

  // Build the IR
  const ir: AddEntityIRV1Type = {
    kind: "AddEntity",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oimlVersion,
      model: context.model
    },
    entity: {
      name: intent.entity,
      storage: {
        kind: "RelationalTable",
        tableName,
        primaryKey: primaryKeyField ? { kind: "Single", field: primaryKeyField } : { kind: "Single", field: "id" } // Fallback
      },
      fields,
      constraints: constraints.length > 0 ? constraints : undefined,
      createdByIntent: context.intentId,
      updatedByIntents: []
    },
    diagnostics: diagnostics.getDiagnostics()
  };

  // Validate the IR with Zod
  const validationResult = AddEntityIRV1.safeParse(ir);

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
