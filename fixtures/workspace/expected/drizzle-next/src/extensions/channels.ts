// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated channels handlers.
// You own this file: OSL never rewrites it.

import type { Channel, NewChannel } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/channels";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewChannel, _ctx: HookContext): Promise<NewChannel> {
    return input;
  },
  async afterCreate(_row: Channel, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Channel, patch: Partial<NewChannel>, _ctx: HookContext): Promise<Partial<NewChannel>> {
    return patch;
  },
  async afterUpdate(_row: Channel, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Channel, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Channel, _ctx: HookContext): Promise<void> {}
};
