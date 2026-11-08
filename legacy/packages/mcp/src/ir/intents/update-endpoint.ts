/**
 * IR envelope for an `update_endpoint` intent.
 * Version: 1.0.0
 */

import { z } from "zod";
import { DiagnosticIR, ProvenanceIR } from "../common.js";

export const RelationSourceIR = z
  .object({
    type: z.literal("relation"),
    /** Relation name to include */
    relation: z.string().min(1),
    /** Optional field to select from the relation */
    field: z.string().optional()
  })
  .strict();

export type RelationSourceIR = z.infer<typeof RelationSourceIR>;

export const FieldSourceIR_Field = z
  .object({
    type: z.literal("field"),
    /** Entity name */
    entity: z.string().min(1),
    /** Field name */
    field: z.string().min(1)
  })
  .strict();

export type FieldSourceIR_Field = z.infer<typeof FieldSourceIR_Field>;

export const ComputedSourceIR = z
  .object({
    type: z.literal("computed"),
    /** Expression or function to compute the value */
    expression: z.string().min(1)
  })
  .strict();

export type ComputedSourceIR = z.infer<typeof ComputedSourceIR>;

export const JoinSourceIR = z
  .object({
    type: z.literal("join"),
    /** Foreign key field to join on */
    foreignKey: z.string().min(1),
    /** Target entity to join with */
    targetEntity: z.string().min(1),
    /** Target field to select */
    targetField: z.string().min(1)
  })
  .strict();

export type JoinSourceIR = z.infer<typeof JoinSourceIR>;

/**
 * Source configuration for a field
 */
export const FieldSourceIR = z.discriminatedUnion("type", [
  RelationSourceIR,
  FieldSourceIR_Field,
  ComputedSourceIR,
  JoinSourceIR
]);

export type FieldSourceIR = z.infer<typeof FieldSourceIR>;

/**
 * Field to add to an endpoint response
 */
export const AddFieldUpdateIR = z
  .object({
    /** Name of the field in the response */
    name: z.string().min(1),
    /** Source of the field data */
    source: FieldSourceIR
  })
  .strict();

export type AddFieldUpdateIR = z.infer<typeof AddFieldUpdateIR>;

/**
 * Updates to apply to an endpoint
 */
export const EndpointUpdatesIR = z
  .object({
    /** Fields to add to the response */
    addFields: z.array(AddFieldUpdateIR).optional(),
    /** Fields to remove from the response */
    removeFields: z.array(z.string().min(1)).optional()
  })
  .strict();

export type EndpointUpdatesIR = z.infer<typeof EndpointUpdatesIR>;

/**
 * IR envelope for an `update_endpoint` intent.
 * Represents modifying an existing API endpoint.
 */
export const UpdateEndpointIRV1 = z
  .object({
    /** Discriminator for this IR kind */
    kind: z.literal("UpdateEndpoint"),
    /** IR version */
    irVersion: z.literal("1.0.0"),
    /** Provenance tracking */
    provenance: ProvenanceIR,
    /** HTTP method of the endpoint to update */
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    /** URL path of the endpoint to update */
    path: z.string().regex(/^\//, "must start with '/'"),
    /** Update operations to perform */
    updates: EndpointUpdatesIR,
    /** Non-fatal issues found during resolution */
    diagnostics: z.array(DiagnosticIR)
  })
  .strict();

export type UpdateEndpointIRV1 = z.infer<typeof UpdateEndpointIRV1>;
