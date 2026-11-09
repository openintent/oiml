// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated channel_members procedures.
// You own this file: OSL never rewrites it.

import type { ChannelMember, NewChannelMember } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/channel_members";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewChannelMember, _ctx: HookContext): Promise<NewChannelMember> {
    return input;
  },
  async afterCreate(_row: ChannelMember, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: ChannelMember, patch: Partial<NewChannelMember>, _ctx: HookContext): Promise<Partial<NewChannelMember>> {
    return patch;
  },
  async afterUpdate(_row: ChannelMember, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: ChannelMember, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: ChannelMember, _ctx: HookContext): Promise<void> {}
};
