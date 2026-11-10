// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated attachments handlers.
// You own this file: OSL never rewrites it.

import type { Attachment, NewAttachment } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/attachments";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
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
