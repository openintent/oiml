// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated milestone_labels handlers.
// You own this file: OSL never rewrites it.

import type { MilestoneLabel, NewMilestoneLabel } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/milestone_labels";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewMilestoneLabel, _ctx: HookContext): Promise<NewMilestoneLabel> {
    return input;
  },
  async afterCreate(_row: MilestoneLabel, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: MilestoneLabel, patch: Partial<NewMilestoneLabel>, _ctx: HookContext): Promise<Partial<NewMilestoneLabel>> {
    return patch;
  },
  async afterUpdate(_row: MilestoneLabel, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: MilestoneLabel, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: MilestoneLabel, _ctx: HookContext): Promise<void> {}
};
