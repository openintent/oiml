// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated track_genres handlers.
// You own this file: OSL never rewrites it.

import type { TrackGenre, NewTrackGenre } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/track_genres";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
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
