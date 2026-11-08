// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated projects procedures.
// You own this file: OSL never rewrites it.

import type { Project, NewProject } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/projects";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
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
