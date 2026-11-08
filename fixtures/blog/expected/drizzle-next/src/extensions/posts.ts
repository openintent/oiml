// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated posts handlers.
// You own this file: OSL never rewrites it.

import type { Article, NewArticle } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/posts";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
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
