/**
 * Entity IR definitions
 * Version: 1.0.0
 */

import { z } from "zod";
import { FieldIRV1 } from "./field.js";
import { EntityStorageIR, ConstraintIR } from "./storage.js";
import { SeedIRV1 } from "./seed.js";

/**
 * Resolved entity definition.
 */
export const EntityIRV1 = z
  .object({
    /** Logical name used in code and schema, e.g. "Issue" */
    name: z.string().min(1),
    /** Optional namespace/module grouping, e.g. "work" */
    namespace: z.string().optional(),
    module: z.string().optional(),
    /** Human-facing labels */
    labelSingular: z.string().optional(),
    labelPlural: z.string().optional(),
    /** Human description of the entity */
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    /** Storage-level details (table, primary key, tenant scope, etc.) */
    storage: EntityStorageIR,
    /** Resolved field definitions */
    fields: z.array(FieldIRV1).min(1),
    /** Unique constraints, indexes, etc. */
    constraints: z.array(ConstraintIR).optional(),
    /** Seeding configuration */
    seed: SeedIRV1.optional(),
    /** Traceability */
    createdByIntent: z.string().min(1),
    updatedByIntents: z.array(z.string())
  })
  .strict();

export type EntityIRV1 = z.infer<typeof EntityIRV1>;
