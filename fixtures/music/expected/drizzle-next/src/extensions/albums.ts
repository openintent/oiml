// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated albums handlers.
// You own this file: OSL never rewrites it.

import type { Album, NewAlbum } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/albums";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
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
