// Created once by OSL (@osl/backend-drizzle-next). Mark the article published. POST /api/posts/{id}/publish: ctx.row is the Article; return the row to answer with it.
// You own this file: OSL never rewrites it.

import type { ActionContext } from "@/generated/actions";
import type { Article } from "@/generated/db/schema";
import type { PostsPublishInput } from "@/generated/validation";

// Throw an error from "@/generated/http" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<PostsPublishInput, Article>): Promise<Article> {
  return ctx.row;
}
