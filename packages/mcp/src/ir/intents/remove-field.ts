/**
 * IR envelope for a `remove_field` intent.
 * Version: 1.0.0
 */

import { z } from "zod";
import { DiagnosticIR, ProvenanceIR } from "../common.js";

/**
 * IR envelope for a `remove_field` intent.
 * Represents removing fields from an existing entity.
 */
export const RemoveFieldIRV1 = z
  .object({
    /** Discriminator for this IR kind */
    kind: z.literal("RemoveField"),
    /** IR version */
    irVersion: z.literal("1.0.0"),
    /** Provenance tracking */
    provenance: ProvenanceIR,
    /** Target entity name */
    entityName: z.string().min(1),
    /** Field names to remove */
    fieldNames: z.array(z.string().min(1)).min(1),
    /** Non-fatal issues found during resolution */
    diagnostics: z.array(DiagnosticIR)
  })
  .strict();

export type RemoveFieldIRV1 = z.infer<typeof RemoveFieldIRV1>;
