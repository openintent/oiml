// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated channel_invites procedures.
// You own this file: OSL never rewrites it.

import type { ChannelInvite, NewChannelInvite } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/channel_invites";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
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
