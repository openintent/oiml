// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated follows handlers.
// You own this file: OSL never rewrites it.

import type { Follow, NewFollow } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/follows";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewFollow, _ctx: HookContext): Promise<NewFollow> {
    return input;
  },
  async afterCreate(_row: Follow, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Follow, patch: Partial<NewFollow>, _ctx: HookContext): Promise<Partial<NewFollow>> {
    return patch;
  },
  async afterUpdate(_row: Follow, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Follow, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Follow, _ctx: HookContext): Promise<void> {}
};
