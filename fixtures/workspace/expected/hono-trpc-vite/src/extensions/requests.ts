// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated requests procedures.
// You own this file: OSL never rewrites it.

import type { Request, NewRequest } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/requests";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewRequest, _ctx: HookContext): Promise<NewRequest> {
    return input;
  },
  async afterCreate(_row: Request, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Request, patch: Partial<NewRequest>, _ctx: HookContext): Promise<Partial<NewRequest>> {
    return patch;
  },
  async afterUpdate(_row: Request, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Request, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Request, _ctx: HookContext): Promise<void> {}
};
