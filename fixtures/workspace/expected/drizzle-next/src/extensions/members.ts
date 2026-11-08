// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated members handlers.
// You own this file: OSL never rewrites it.

import type { TeamMember, NewTeamMember } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/members";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
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
