// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated article_editors procedures.
// You own this file: OSL never rewrites it.

import type { ArticleEditor, NewArticleEditor } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/article_editors";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
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
