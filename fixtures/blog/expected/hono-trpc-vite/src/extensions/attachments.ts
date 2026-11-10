// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated attachments procedures.
// You own this file: OSL never rewrites it.

import type { Attachment, NewAttachment } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/attachments";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewAttachment, _ctx: HookContext): Promise<NewAttachment> {
    return input;
  },
  async afterCreate(_row: Attachment, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Attachment, patch: Partial<NewAttachment>, _ctx: HookContext): Promise<Partial<NewAttachment>> {
    return patch;
  },
  async afterUpdate(_row: Attachment, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Attachment, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Attachment, _ctx: HookContext): Promise<void> {}
};
