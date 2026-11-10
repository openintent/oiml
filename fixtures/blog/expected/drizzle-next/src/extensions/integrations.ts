// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated integrations handlers.
// You own this file: OSL never rewrites it.

import type { Integration, NewIntegration } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/integrations";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewIntegration, _ctx: HookContext): Promise<NewIntegration> {
    return input;
  },
  async afterCreate(_row: Integration, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Integration, patch: Partial<NewIntegration>, _ctx: HookContext): Promise<Partial<NewIntegration>> {
    return patch;
  },
  async afterUpdate(_row: Integration, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Integration, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Integration, _ctx: HookContext): Promise<void> {}
};
