// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated article_invites handlers.
// You own this file: OSL never rewrites it.

import type { ArticleInvite, NewArticleInvite } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/article_invites";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewArticleInvite, _ctx: HookContext): Promise<NewArticleInvite> {
    return input;
  },
  async afterCreate(_row: ArticleInvite, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: ArticleInvite, patch: Partial<NewArticleInvite>, _ctx: HookContext): Promise<Partial<NewArticleInvite>> {
    return patch;
  },
  async afterUpdate(_row: ArticleInvite, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: ArticleInvite, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: ArticleInvite, _ctx: HookContext): Promise<void> {}
};
