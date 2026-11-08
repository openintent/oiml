// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated notes handlers.
// You own this file: OSL never rewrites it.

import type { TaskNote, NewTaskNote } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/notes";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
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
