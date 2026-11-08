/**
 * IR envelope for an `add_field` intent.
 * Version: 1.0.0
 */

import { z } from "zod";
import { DiagnosticIR, ProvenanceIR } from "../common.js";
import { FieldIRV1 } from "../field.js";

/**
 * IR envelope for an `add_field` intent.
 * Represents adding fields to an existing entity.
 */
export const AddFieldIRV1 = z
  .object({
    /** Discriminator for this IR kind */
    kind: z.literal("AddField"),
    /** IR version */
    irVersion: z.literal("1.0.0"),
    /** Provenance tracking */
    provenance: ProvenanceIR,
    /** Target entity name */
    entityName: z.string().min(1),
    /** Resolved fields to add */
    fields: z.array(FieldIRV1).min(1),
    /** Non-fatal issues found during resolution */
    diagnostics: z.array(DiagnosticIR)
  })
  .strict();

export type AddFieldIRV1 = z.infer<typeof AddFieldIRV1>;
