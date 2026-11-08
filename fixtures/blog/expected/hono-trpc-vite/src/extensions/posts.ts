// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated posts procedures.
// You own this file: OSL never rewrites it.

import type { Article, NewArticle } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/posts";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: NewArticle, _ctx: HookContext): Promise<NewArticle> {
    return input;
  },
  async afterCreate(_row: Article, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Article, patch: Partial<NewArticle>, _ctx: HookContext): Promise<Partial<NewArticle>> {
    return patch;
  },
  async afterUpdate(_row: Article, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Article, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Article, _ctx: HookContext): Promise<void> {}
};
