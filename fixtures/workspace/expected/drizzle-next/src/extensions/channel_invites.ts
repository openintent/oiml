// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated channel_invites handlers.
// You own this file: OSL never rewrites it.

import type { ChannelInvite, NewChannelInvite } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/channel_invites";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewChannelInvite, _ctx: HookContext): Promise<NewChannelInvite> {
    return input;
  },
  async afterCreate(_row: ChannelInvite, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: ChannelInvite, patch: Partial<NewChannelInvite>, _ctx: HookContext): Promise<Partial<NewChannelInvite>> {
    return patch;
  },
  async afterUpdate(_row: ChannelInvite, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: ChannelInvite, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: ChannelInvite, _ctx: HookContext): Promise<void> {}
};
