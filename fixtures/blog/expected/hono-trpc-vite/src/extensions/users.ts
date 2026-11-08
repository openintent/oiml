// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated users procedures.
// You own this file: OSL never rewrites it.

import type { User, NewUser } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/users";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewUser, _ctx: HookContext): Promise<NewUser> {
    return input;
  },
  async afterCreate(_row: User, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: User, patch: Partial<NewUser>, _ctx: HookContext): Promise<Partial<NewUser>> {
    return patch;
  },
  async afterUpdate(_row: User, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: User, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: User, _ctx: HookContext): Promise<void> {}
};
