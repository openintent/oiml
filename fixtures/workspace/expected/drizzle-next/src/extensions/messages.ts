// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated messages handlers.
// You own this file: OSL never rewrites it.

import type { Message, NewMessage } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/messages";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewMessage, _ctx: HookContext): Promise<NewMessage> {
    return input;
  },
  async afterCreate(_row: Message, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Message, patch: Partial<NewMessage>, _ctx: HookContext): Promise<Partial<NewMessage>> {
    return patch;
  },
  async afterUpdate(_row: Message, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Message, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Message, _ctx: HookContext): Promise<void> {}
};
