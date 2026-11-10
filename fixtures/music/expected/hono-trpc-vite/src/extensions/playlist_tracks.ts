// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated playlist_tracks procedures.
// You own this file: OSL never rewrites it.

import type { PlaylistTrack, NewPlaylistTrack } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/playlist_tracks";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewPlaylistTrack, _ctx: HookContext): Promise<NewPlaylistTrack> {
    return input;
  },
  async afterCreate(_row: PlaylistTrack, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: PlaylistTrack, patch: Partial<NewPlaylistTrack>, _ctx: HookContext): Promise<Partial<NewPlaylistTrack>> {
    return patch;
  },
  async afterUpdate(_row: PlaylistTrack, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: PlaylistTrack, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: PlaylistTrack, _ctx: HookContext): Promise<void> {}
};
