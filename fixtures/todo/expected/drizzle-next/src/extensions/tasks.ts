// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated tasks handlers.
// You own this file: OSL never rewrites it.

import type { Task, NewTask } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/tasks";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
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
