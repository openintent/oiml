/**
 * Open Intent Modeling Language (OIML) Plan Schema - Zod Export
 * Version: 0.1.0
 *
 * This file provides Zod schema definitions for implementation plan validation.
 * For JSON Schema validation, use schema.json instead.
 */

import { z } from "zod";

// Utility schemas
export const OIMLVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "semver required");
export const ISODate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/, "ISO8601 UTC required"), z.date()])
  .transform(val => {
    // Normalize Date objects to ISO string format
    if (val instanceof Date) {
      return val.toISOString();
    }
    return val;
  });

/**
 * Planned action on a file
 */
export const PlannedFileAction = z.enum(["create", "modify", "delete", "regenerate"]);

/**
 * A planned change to a file
 */
export const PlannedChange = z
  .object({
    file: z.string().min(1).describe("File path relative to project root"),
    action: PlannedFileAction.describe("Action to perform on the file"),
    description: z.string().min(1).describe("Human-readable description of the planned change"),
    steps: z.array(z.string()).optional().describe("Detailed steps (optional)"),
    dependencies: z.array(z.string()).optional().describe("Files that must exist or be changed first")
  })
  .strict();

/**
 * Template pack information for the plan
 */
export const TemplatePack = z
  .object({
    framework: z.string().min(1).describe('Framework name (e.g., "prisma", "next")'),
    category: z.enum(["database", "api", "ui", "capability"]).describe("Framework category"),
    pack: z.string().min(1).describe("Template pack URI"),
    version: z.string().min(1).describe("Template version"),
    digest: z.string().optional().describe("Content digest for verification"),
    compat: z.record(z.string()).optional().describe("Compatibility constraints")
  })
  .strict();

/**
 * Scope of an intent
 */
export const IntentScope = z.enum(["data", "api", "ui", "capability"]);

/**
 * Intent processing step in the plan
 */
export const IntentStep = z
  .object({
    kind: z.string().min(1).describe('Intent kind (e.g., "add_entity", "add_endpoint")'),
    scope: IntentScope.describe('Intent scope (e.g., "data", "api", "ui")'),
    target: z.string().min(1).describe("Target entity/component/endpoint name"),
    description: z.string().min(1).describe("Human-readable description of what this intent will accomplish"),
    changes: z.array(PlannedChange).describe("Expected changes from processing this intent")
  })
  .strict();

/**
 * Risk level for the planned changes
 */
export const RiskLevel = z.enum(["low", "medium", "high"]);

/**
 * Risk assessment for the planned changes
 */
export const RiskAssessment = z
  .object({
    level: RiskLevel.describe("Overall risk level"),
    factors: z.array(z.string()).describe("Risk factors identified"),
    mitigations: z.array(z.string()).optional().describe("Mitigation strategies")
  })
  .strict();

/**
 * Prerequisites that must be satisfied before execution
 */
export const Prerequisites = z
  .object({
    config_checks: z.array(z.string()).optional().describe("Required configuration checks"),
    dependencies: z.array(z.string()).optional().describe("Required dependencies"),
    required_files: z.array(z.string()).optional().describe("Required files that must exist")
  })
  .strict();

/**
 * Complete implementation plan for an intent file
 * Version: 0.1.0
 */
export const ImplementationPlanV010 = z
  .object({
    version: z.literal("0.1.0").describe("Schema version"),
    created_at: ISODate.describe("Plan creation timestamp (ISO8601)"),
    intent_id: z.string().describe("Intent file identifier"),
    project_id: z.string().optional().describe("Project identifier"),
    model: z.string().optional().describe("AI model generating the plan"),
    intents_to_process: z.number().int().min(1).describe("Number of intents to process"),
    template_used: TemplatePack.describe("Template pack information"),
    steps: z.array(IntentStep).min(1).describe("Ordered sequence of intent processing steps"),
    planned_changes: z.array(PlannedChange).min(1).describe("All planned file changes (aggregated from steps)"),
    risk_assessment: RiskAssessment.optional().describe("Risk assessment for the planned changes"),
    warnings: z.array(z.string()).optional().describe("Any warnings or important notes"),
    prerequisites: Prerequisites.optional().describe("Prerequisites that must be satisfied before execution"),
    estimated_duration: z.string().optional().describe("Estimated execution time (e.g., '2-3 minutes')")
  })
  .strict();

/**
 * Top-level schema for implementation plan files
 * Supports version 0.1.0
 */
export const ImplementationPlan = ImplementationPlanV010;

// Export all schemas
export default {
  OIMLVersion,
  ISODate,
  PlannedFileAction,
  PlannedChange,
  TemplatePack,
  IntentScope,
  IntentStep,
  RiskLevel,
  RiskAssessment,
  Prerequisites,
  ImplementationPlanV010,
  ImplementationPlan
};
