// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated comments handlers.
// You own this file: OSL never rewrites it.

import type { Comment, NewComment } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/comments";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewComment, _ctx: HookContext): Promise<NewComment> {
    return input;
  },
  async afterCreate(_row: Comment, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Comment, patch: Partial<NewComment>, _ctx: HookContext): Promise<Partial<NewComment>> {
    return patch;
  },
  async afterUpdate(_row: Comment, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Comment, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Comment, _ctx: HookContext): Promise<void> {}
};
