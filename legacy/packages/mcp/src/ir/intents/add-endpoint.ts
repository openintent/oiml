/**
 * IR envelope for an `add_endpoint` intent.
 * Version: 1.0.0
 */

import { z } from "zod";
import { DiagnosticIR, ProvenanceIR } from "../common.js";
import { FieldIRV1 } from "../field.js";

/**
 * Authentication configuration for an endpoint
 */
export const EndpointAuthIR = z
  .object({
    /** Whether authentication is required */
    required: z.boolean(),
    /** Required roles (if any) */
    roles: z.array(z.string()).optional()
  })
  .strict();

export type EndpointAuthIR = z.infer<typeof EndpointAuthIR>;

/**
 * Resolved endpoint definition
 */
export const EndpointIR = z
  .object({
    /** HTTP method */
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    /** URL path (must start with /) */
    path: z.string().regex(/^\//, "must start with '/'"),
    /** Human description */
    description: z.string().optional(),
    /** Related entity name (if any) */
    entity: z.string().optional(),
    /** Response fields (if specified) */
    responseFields: z.array(FieldIRV1).optional(),
    /** Request body fields (if specified) */
    requestFields: z.array(FieldIRV1).optional(),
    /** Authentication configuration */
    auth: EndpointAuthIR.optional()
  })
  .strict();

export type EndpointIR = z.infer<typeof EndpointIR>;

/**
 * IR envelope for an `add_endpoint` intent.
 * Represents creating a new API endpoint.
 */
export const AddEndpointIRV1 = z
  .object({
    /** Discriminator for this IR kind */
    kind: z.literal("AddEndpoint"),
    /** IR version */
    irVersion: z.literal("1.0.0"),
    /** Provenance tracking */
    provenance: ProvenanceIR,
    /** Endpoint configuration */
    endpoint: EndpointIR,
    /** Non-fatal issues found during resolution */
    diagnostics: z.array(DiagnosticIR)
  })
  .strict();

export type AddEndpointIRV1 = z.infer<typeof AddEndpointIRV1>;
