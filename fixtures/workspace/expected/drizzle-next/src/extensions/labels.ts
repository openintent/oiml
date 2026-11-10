// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated labels handlers.
// You own this file: OSL never rewrites it.

import type { Label, NewLabel } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/labels";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewLabel, _ctx: HookContext): Promise<NewLabel> {
    return input;
  },
  async afterCreate(_row: Label, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Label, patch: Partial<NewLabel>, _ctx: HookContext): Promise<Partial<NewLabel>> {
    return patch;
  },
  async afterUpdate(_row: Label, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Label, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Label, _ctx: HookContext): Promise<void> {}
};
