/**
 * Storage-level IR definitions
 * Version: 1.0.0
 */

import { z } from "zod";

export const PrimaryKeyIR = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("Single"), field: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("Composite"),
      fields: z.array(z.string().min(1)).min(2)
    })
    .strict()
]);

export type PrimaryKeyIR = z.infer<typeof PrimaryKeyIR>;

/**
 * v1: single-column tenant scope.
 * Can be extended later with row-level policies, etc.
 */
export const TenantScopeIR = z
  .object({
    mode: z.literal("Column"),
    column: z.string().min(1) // e.g. "workspaceId"
  })
  .strict();

export type TenantScopeIR = z.infer<typeof TenantScopeIR>;

export const RelationalTableStorageIR = z
  .object({
    kind: z.literal("RelationalTable"),
    /** Concrete table name, e.g. "issues" */
    tableName: z.string().min(1),
    /** Optional schema name, e.g. "public" */
    schema: z.string().optional(),
    /** Primary key definition */
    primaryKey: PrimaryKeyIR,
    /** Multi-tenant scoping strategy */
    tenantScoping: TenantScopeIR.optional()
  })
  .strict();

export type RelationalTableStorageIR = z.infer<typeof RelationalTableStorageIR>;

/**
 * Where and how an entity is stored.
 * v1 assumes a relational table; variants can be added later.
 */
export const EntityStorageIR = RelationalTableStorageIR;

export type EntityStorageIR = z.infer<typeof EntityStorageIR>;

export const UniqueConstraintIR = z
  .object({
    kind: z.literal("Unique"),
    name: z.string().optional(),
    fields: z.array(z.string().min(1)).min(1)
  })
  .strict();

export type UniqueConstraintIR = z.infer<typeof UniqueConstraintIR>;

export const IndexConstraintIR = z
  .object({
    kind: z.literal("Index"),
    name: z.string().optional(),
    fields: z.array(z.string().min(1)).min(1),
    unique: z.boolean().optional(),
    /** Index type hint (e.g., "btree", "hash", "gist", "gin") */
    type: z.string().optional()
  })
  .strict();

export type IndexConstraintIR = z.infer<typeof IndexConstraintIR>;

/**
 * Constraints (unique, indexes, etc.).
 */
export const ConstraintIR = z.discriminatedUnion("kind", [UniqueConstraintIR, IndexConstraintIR]);

export type ConstraintIR = z.infer<typeof ConstraintIR>;
