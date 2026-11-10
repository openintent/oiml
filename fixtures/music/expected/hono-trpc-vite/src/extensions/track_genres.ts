// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated track_genres procedures.
// You own this file: OSL never rewrites it.

import type { TrackGenre, NewTrackGenre } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/track_genres";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewTrackGenre, _ctx: HookContext): Promise<NewTrackGenre> {
    return input;
  },
  async afterCreate(_row: TrackGenre, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: TrackGenre, patch: Partial<NewTrackGenre>, _ctx: HookContext): Promise<Partial<NewTrackGenre>> {
    return patch;
  },
  async afterUpdate(_row: TrackGenre, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: TrackGenre, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: TrackGenre, _ctx: HookContext): Promise<void> {}
};
