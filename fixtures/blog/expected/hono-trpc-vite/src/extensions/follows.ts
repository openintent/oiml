// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated follows procedures.
// You own this file: OSL never rewrites it.

import type { Follow, NewFollow } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/follows";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewFollow, _ctx: HookContext): Promise<NewFollow> {
    return input;
  },
  async afterCreate(_row: Follow, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Follow, patch: Partial<NewFollow>, _ctx: HookContext): Promise<Partial<NewFollow>> {
    return patch;
  },
  async afterUpdate(_row: Follow, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Follow, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Follow, _ctx: HookContext): Promise<void> {}
};
