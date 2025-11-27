/**
 * IR envelope for an `add_component` intent.
 * Version: 1.0.0
 */

import { z } from "zod";
import { DiagnosticIR, ProvenanceIR } from "../common.js";

/**
 * Resolved component definition
 */
export const ComponentIR = z
  .object({
    /** Component name */
    name: z.string().min(1),
    /** Template type */
    template: z.enum(["List", "Form", "Custom"]),
    /** Related entity (if any) */
    entity: z.string().optional(),
    /** Fields to display */
    displayFields: z.array(z.string().min(1)).optional(),
    /** Route/path for the component */
    route: z.string().optional()
  })
  .strict();

export type ComponentIR = z.infer<typeof ComponentIR>;

/**
 * IR envelope for an `add_component` intent.
 * Represents creating a new UI component.
 */
export const AddComponentIRV1 = z
  .object({
    /** Discriminator for this IR kind */
    kind: z.literal("AddComponent"),
    /** IR version */
    irVersion: z.literal("1.0.0"),
    /** Provenance tracking */
    provenance: ProvenanceIR,
    /** Component configuration */
    component: ComponentIR,
    /** Non-fatal issues found during resolution */
    diagnostics: z.array(DiagnosticIR)
  })
  .strict();

export type AddComponentIRV1 = z.infer<typeof AddComponentIRV1>;
