/**
 * Seeding configuration IR definitions
 * Version: 1.0.0
 */

import { z } from "zod";

export const FieldSeedGeneratorIR = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("Faker"), path: z.string().min(1) }).strict(), // e.g. "lorem.sentence"
  z
    .object({
      kind: z.literal("EnumWeights"),
      values: z.array(z.string()),
      weights: z.array(z.number()).optional()
    })
    .strict(),
  z.object({ kind: z.literal("Literal"), value: z.any() }).strict(),
  z
    .object({
      kind: z.literal("Sequential"),
      start: z.number().optional(),
      step: z.number().optional()
    })
    .strict()
]);

export type FieldSeedGeneratorIR = z.infer<typeof FieldSeedGeneratorIR>;

/**
 * Seeding configuration for an entity.
 */
export const SeedIRV1 = z
  .object({
    /** Random vs fixtures-based */
    mode: z.enum(["Random", "Fixtures"]),
    /** Where seeding is allowed */
    environments: z.array(z.enum(["dev", "preview", "test", "prod"])).min(1),
    /** Number of rows to generate in Random mode */
    count: z.number().int().positive().optional(),
    /** Per-field generator config */
    generatorByField: z.record(z.string(), FieldSeedGeneratorIR).optional(),
    /** Path to fixtures file in Fixtures mode */
    fixturesPath: z.string().optional()
  })
  .strict();

export type SeedIRV1 = z.infer<typeof SeedIRV1>;
