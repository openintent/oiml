// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated bulletins handlers.
// You own this file: OSL never rewrites it.

import type { Bulletin, NewBulletin } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/bulletins";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewBulletin, _ctx: HookContext): Promise<NewBulletin> {
    return input;
  },
  async afterCreate(_row: Bulletin, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Bulletin, patch: Partial<NewBulletin>, _ctx: HookContext): Promise<Partial<NewBulletin>> {
    return patch;
  },
  async afterUpdate(_row: Bulletin, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Bulletin, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Bulletin, _ctx: HookContext): Promise<void> {}
};
