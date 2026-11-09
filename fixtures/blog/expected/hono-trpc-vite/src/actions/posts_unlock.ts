// Created once by OSL (@osl/backend-hono-trpc-vite). Reopen the article to comments. POST /api/posts/{id}/unlock: ctx.row is the Article; return the row to answer with it.
// You own this file: OSL never rewrites it.

import type { ActionContext } from "@generated/actions";
import type { Article } from "@generated/db/schema";
import type { PostsUnlockInput } from "@generated/validation";

// Throw an error from "@generated/server/errors" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<PostsUnlockInput, Article>): Promise<Article> {
  return ctx.row;
}
