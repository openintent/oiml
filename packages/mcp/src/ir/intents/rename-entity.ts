/**
 * IR envelope for a `rename_entity` intent.
 * Version: 1.0.0
 */

import { z } from "zod";
import { DiagnosticIR, ProvenanceIR } from "../common.js";

/**
 * IR envelope for a `rename_entity` intent.
 * Represents renaming an existing entity.
 */
export const RenameEntityIRV1 = z
  .object({
    /** Discriminator for this IR kind */
    kind: z.literal("RenameEntity"),
    /** IR version */
    irVersion: z.literal("1.0.0"),
    /** Provenance tracking */
    provenance: ProvenanceIR,
    /** Current entity name */
    fromName: z.string().min(1),
    /** New entity name */
    toName: z.string().min(1),
    /** Whether to update references automatically */
    updateReferences: z.boolean(),
    /** Non-fatal issues found during resolution */
    diagnostics: z.array(DiagnosticIR)
  })
  .strict();

export type RenameEntityIRV1 = z.infer<typeof RenameEntityIRV1>;
