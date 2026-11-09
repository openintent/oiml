// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated notes handlers.
// You own this file: OSL never rewrites it.

import type { Note, NewNote } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/notes";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewNote, _ctx: HookContext): Promise<NewNote> {
    return input;
  },
  async afterCreate(_row: Note, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Note, patch: Partial<NewNote>, _ctx: HookContext): Promise<Partial<NewNote>> {
    return patch;
  },
  async afterUpdate(_row: Note, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Note, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Note, _ctx: HookContext): Promise<void> {}
};
