// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated channel_members handlers.
// You own this file: OSL never rewrites it.

import type { ChannelMember, NewChannelMember } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/channel_members";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
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
