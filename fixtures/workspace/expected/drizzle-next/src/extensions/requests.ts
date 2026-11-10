// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated requests handlers.
// You own this file: OSL never rewrites it.

import type { Request, NewRequest } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/requests";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewRequest, _ctx: HookContext): Promise<NewRequest> {
    return input;
  },
  async afterCreate(_row: Request, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Request, patch: Partial<NewRequest>, _ctx: HookContext): Promise<Partial<NewRequest>> {
    return patch;
  },
  async afterUpdate(_row: Request, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Request, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Request, _ctx: HookContext): Promise<void> {}
};
