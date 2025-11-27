/**
 * IR envelope for a `remove_entity` intent.
 * Version: 1.0.0
 */

import { z } from "zod";
import { DiagnosticIR, ProvenanceIR } from "../common.js";

/**
 * IR envelope for a `remove_entity` intent.
 * Represents removing an existing entity from the schema.
 */
export const RemoveEntityIRV1 = z
  .object({
    /** Discriminator for this IR kind */
    kind: z.literal("RemoveEntity"),
    /** IR version */
    irVersion: z.literal("1.0.0"),
    /** Provenance tracking */
    provenance: ProvenanceIR,
    /** Entity name to remove */
    entityName: z.string().min(1),
    /** Whether to cascade delete related data */
    cascade: z.boolean(),
    /** Non-fatal issues found during resolution */
    diagnostics: z.array(DiagnosticIR)
  })
  .strict();

export type RemoveEntityIRV1 = z.infer<typeof RemoveEntityIRV1>;
