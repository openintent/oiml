// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated artists handlers.
// You own this file: OSL never rewrites it.

import type { Artist, NewArtist } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/artists";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
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
