// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated team_invites procedures.
// You own this file: OSL never rewrites it.

import type { TeamInvite, NewTeamInvite } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/team_invites";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewTeamInvite, _ctx: HookContext): Promise<NewTeamInvite> {
    return input;
  },
  async afterCreate(_row: TeamInvite, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: TeamInvite, patch: Partial<NewTeamInvite>, _ctx: HookContext): Promise<Partial<NewTeamInvite>> {
    return patch;
  },
  async afterUpdate(_row: TeamInvite, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: TeamInvite, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: TeamInvite, _ctx: HookContext): Promise<void> {}
};
