// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated notes procedures.
// You own this file: OSL never rewrites it.

import type { Note, NewNote } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/notes";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
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
