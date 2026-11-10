// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated article_editors handlers.
// You own this file: OSL never rewrites it.

import type { ArticleEditor, NewArticleEditor } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/article_editors";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewArticleEditor, _ctx: HookContext): Promise<NewArticleEditor> {
    return input;
  },
  async afterCreate(_row: ArticleEditor, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: ArticleEditor, patch: Partial<NewArticleEditor>, _ctx: HookContext): Promise<Partial<NewArticleEditor>> {
    return patch;
  },
  async afterUpdate(_row: ArticleEditor, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: ArticleEditor, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: ArticleEditor, _ctx: HookContext): Promise<void> {}
};
