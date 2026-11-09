// Created once by OSL (@osl/backend-hono-trpc-vite). Close the article to new comments. POST /api/posts/{id}/lock: ctx.row is the Article; return the row to answer with it.
// You own this file: OSL never rewrites it.

import type { ActionContext } from "@generated/actions";
import type { Article } from "@generated/db/schema";
import type { PostsLockInput } from "@generated/validation";

// Throw an error from "@generated/server/errors" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<PostsLockInput, Article>): Promise<Article> {
  return ctx.row;
}
