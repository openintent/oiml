/**
 * IR envelope for an `add_entity` intent.
 * This is the framework-agnostic, deterministic representation of a domain entity.
 * Version: 1.0.0
 */

import { z } from "zod";
import { DiagnosticIR, ProvenanceIR } from "../common.js";
import { EntityIRV1 } from "../entity.js";

/**
 * IR envelope for an `add_entity` intent.
 * This is the framework-agnostic, deterministic representation of a domain entity.
 */
export const AddEntityIRV1 = z
  .object({
    /** Discriminator for this IR kind */
    kind: z.literal("AddEntity"),
    /** IR version – bump on breaking semantic changes */
    irVersion: z.literal("1.0.0"),
    /** Provenance tracking */
    provenance: ProvenanceIR,
    /** Resolved entity semantics */
    entity: EntityIRV1,
    /** Non-fatal issues found during resolution */
    diagnostics: z.array(DiagnosticIR)
  })
  .strict();

export type AddEntityIRV1 = z.infer<typeof AddEntityIRV1>;
