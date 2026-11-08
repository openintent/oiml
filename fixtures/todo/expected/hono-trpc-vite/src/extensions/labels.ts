// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated labels procedures.
// You own this file: OSL never rewrites it.

import type { Label, NewLabel } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/labels";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewLabel, _ctx: HookContext): Promise<NewLabel> {
    return input;
  },
  async afterCreate(_row: Label, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Label, patch: Partial<NewLabel>, _ctx: HookContext): Promise<Partial<NewLabel>> {
    return patch;
  },
  async afterUpdate(_row: Label, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Label, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Label, _ctx: HookContext): Promise<void> {}
};
