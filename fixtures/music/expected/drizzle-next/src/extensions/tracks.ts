// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated tracks handlers.
// You own this file: OSL never rewrites it.

import type { Track, NewTrack } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/tracks";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewTrack, _ctx: HookContext): Promise<NewTrack> {
    return input;
  },
  async afterCreate(_row: Track, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Track, patch: Partial<NewTrack>, _ctx: HookContext): Promise<Partial<NewTrack>> {
    return patch;
  },
  async afterUpdate(_row: Track, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Track, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Track, _ctx: HookContext): Promise<void> {}
};
