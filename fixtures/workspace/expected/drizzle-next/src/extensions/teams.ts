// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated teams handlers.
// You own this file: OSL never rewrites it.

import type { Team, NewTeam } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/teams";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewTeam, _ctx: HookContext): Promise<NewTeam> {
    return input;
  },
  async afterCreate(_row: Team, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Team, patch: Partial<NewTeam>, _ctx: HookContext): Promise<Partial<NewTeam>> {
    return patch;
  },
  async afterUpdate(_row: Team, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Team, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Team, _ctx: HookContext): Promise<void> {}
};
