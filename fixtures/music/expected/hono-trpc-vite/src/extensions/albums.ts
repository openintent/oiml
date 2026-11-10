// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated albums procedures.
// You own this file: OSL never rewrites it.

import type { Album, NewAlbum } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/albums";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewAlbum, _ctx: HookContext): Promise<NewAlbum> {
    return input;
  },
  async afterCreate(_row: Album, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Album, patch: Partial<NewAlbum>, _ctx: HookContext): Promise<Partial<NewAlbum>> {
    return patch;
  },
  async afterUpdate(_row: Album, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Album, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Album, _ctx: HookContext): Promise<void> {}
};
