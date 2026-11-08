// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated notes procedures.
// You own this file: OSL never rewrites it.

import type { TaskNote, NewTaskNote } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/notes";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewTaskNote, _ctx: HookContext): Promise<NewTaskNote> {
    return input;
  },
  async afterCreate(_row: TaskNote, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: TaskNote, patch: Partial<NewTaskNote>, _ctx: HookContext): Promise<Partial<NewTaskNote>> {
    return patch;
  },
  async afterUpdate(_row: TaskNote, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: TaskNote, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: TaskNote, _ctx: HookContext): Promise<void> {}
};
