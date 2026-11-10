// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated artists procedures.
// You own this file: OSL never rewrites it.

import type { Artist, NewArtist } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/artists";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewArtist, _ctx: HookContext): Promise<NewArtist> {
    return input;
  },
  async afterCreate(_row: Artist, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Artist, patch: Partial<NewArtist>, _ctx: HookContext): Promise<Partial<NewArtist>> {
    return patch;
  },
  async afterUpdate(_row: Artist, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Artist, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Artist, _ctx: HookContext): Promise<void> {}
};
