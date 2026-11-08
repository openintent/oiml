// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated projects handlers.
// You own this file: OSL never rewrites it.

import type { Project, NewProject } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/projects";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewProject, _ctx: HookContext): Promise<NewProject> {
    return input;
  },
  async afterCreate(_row: Project, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Project, patch: Partial<NewProject>, _ctx: HookContext): Promise<Partial<NewProject>> {
    return patch;
  },
  async afterUpdate(_row: Project, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Project, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Project, _ctx: HookContext): Promise<void> {}
};
