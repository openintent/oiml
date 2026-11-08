/**
 * Common IR types shared across all intent IRs
 * Version: 1.0.0
 */

import { z } from "zod";

/**
 * Diagnostics emitted during resolution; non-fatal issues.
 */
export const DiagnosticIR = z
  .object({
    level: z.enum(["Info", "Warning", "Error"]),
    code: z.string().min(1),
    message: z.string().min(1),
    /** Optional JSONPath-like pointer into the source intent */
    path: z.string().optional()
  })
  .strict();

export type DiagnosticIR = z.infer<typeof DiagnosticIR>;

/**
 * Provenance information tracking intent creation and modifications
 */
export const ProvenanceIR = z
  .object({
    /** Identifier for the source intent (e.g. content hash, URI, filename) */
    intentId: z.string().min(1),
    /** Logical project identifier (repo URL, monorepo ID, etc.) */
    projectId: z.string().min(1),
    /** When this IR was generated */
    generatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/, "ISO8601 UTC required"),
    /** AI model used to generate this IR */
    model: z.string().optional(),
    /** Source intent version */
    sourceIntentVersion: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "semver required")
  })
  .strict();

export type ProvenanceIR = z.infer<typeof ProvenanceIR>;
