// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated tasks procedures.
// You own this file: OSL never rewrites it.

import type { Task, NewTask } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/tasks";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewTask, _ctx: HookContext): Promise<NewTask> {
    return input;
  },
  async afterCreate(_row: Task, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Task, patch: Partial<NewTask>, _ctx: HookContext): Promise<Partial<NewTask>> {
    return patch;
  },
  async afterUpdate(_row: Task, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Task, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Task, _ctx: HookContext): Promise<void> {}
};
