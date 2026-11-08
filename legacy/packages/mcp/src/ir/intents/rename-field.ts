/**
 * IR envelope for a `rename_field` intent.
 * Version: 1.0.0
 */

import { z } from "zod";
import { DiagnosticIR, ProvenanceIR } from "../common.js";

/**
 * IR envelope for a `rename_field` intent.
 * Represents renaming a field in an existing entity.
 */
export const RenameFieldIRV1 = z
  .object({
    /** Discriminator for this IR kind */
    kind: z.literal("RenameField"),
    /** IR version */
    irVersion: z.literal("1.0.0"),
    /** Provenance tracking */
    provenance: ProvenanceIR,
    /** Target entity name */
    entityName: z.string().min(1),
    /** Current field name */
    fromName: z.string().min(1),
    /** New field name */
    toName: z.string().min(1),
    /** Whether to update references automatically */
    updateReferences: z.boolean(),
    /** Non-fatal issues found during resolution */
    diagnostics: z.array(DiagnosticIR)
  })
  .strict();

export type RenameFieldIRV1 = z.infer<typeof RenameFieldIRV1>;
