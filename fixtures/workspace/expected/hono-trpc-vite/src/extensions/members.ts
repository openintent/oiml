// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated members procedures.
// You own this file: OSL never rewrites it.

import type { TeamMember, NewTeamMember } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/members";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewTeamMember, _ctx: HookContext): Promise<NewTeamMember> {
    return input;
  },
  async afterCreate(_row: TeamMember, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: TeamMember, patch: Partial<NewTeamMember>, _ctx: HookContext): Promise<Partial<NewTeamMember>> {
    return patch;
  },
  async afterUpdate(_row: TeamMember, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: TeamMember, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: TeamMember, _ctx: HookContext): Promise<void> {}
};
