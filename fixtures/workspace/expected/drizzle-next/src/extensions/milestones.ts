// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated milestones handlers.
// You own this file: OSL never rewrites it.

import type { Milestone, NewMilestone } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/milestones";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewMilestone, _ctx: HookContext): Promise<NewMilestone> {
    return input;
  },
  async afterCreate(_row: Milestone, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Milestone, patch: Partial<NewMilestone>, _ctx: HookContext): Promise<Partial<NewMilestone>> {
    return patch;
  },
  async afterUpdate(_row: Milestone, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Milestone, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Milestone, _ctx: HookContext): Promise<void> {}
};
