/**
 * IR envelope for an `add_relation` intent.
 * Version: 1.0.0
 */

import { z } from "zod";
import { DiagnosticIR, ProvenanceIR } from "../common.js";
import { ReferenceTypeIR } from "../types.js";

/**
 * Resolved relation definition
 */
export const RelationIR = z
  .object({
    /** Source entity name */
    sourceEntity: z.string().min(1),
    /** Target entity name */
    targetEntity: z.string().min(1),
    /** Field name in the source entity */
    fieldName: z.string().min(1),
    /** Relation type details */
    type: ReferenceTypeIR,
    /** Whether to emit migration for this relation */
    emitMigration: z.boolean()
  })
  .strict();

export type RelationIR = z.infer<typeof RelationIR>;

/**
 * IR envelope for an `add_relation` intent.
 * Represents adding a relationship between two existing entities.
 */
export const AddRelationIRV1 = z
  .object({
    /** Discriminator for this IR kind */
    kind: z.literal("AddRelation"),
    /** IR version */
    irVersion: z.literal("1.0.0"),
    /** Provenance tracking */
    provenance: ProvenanceIR,
    /** Relation details */
    relation: RelationIR,
    /** Non-fatal issues found during resolution */
    diagnostics: z.array(DiagnosticIR)
  })
  .strict();

export type AddRelationIRV1 = z.infer<typeof AddRelationIRV1>;
