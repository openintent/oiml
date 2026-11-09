// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated messages procedures.
// You own this file: OSL never rewrites it.

import type { Message, NewMessage } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/messages";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
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
