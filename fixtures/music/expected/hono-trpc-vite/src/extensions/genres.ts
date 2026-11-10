// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated genres procedures.
// You own this file: OSL never rewrites it.

import type { Genre, NewGenre } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/genres";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewGenre, _ctx: HookContext): Promise<NewGenre> {
    return input;
  },
  async afterCreate(_row: Genre, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Genre, patch: Partial<NewGenre>, _ctx: HookContext): Promise<Partial<NewGenre>> {
    return patch;
  },
  async afterUpdate(_row: Genre, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Genre, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Genre, _ctx: HookContext): Promise<void> {}
};
