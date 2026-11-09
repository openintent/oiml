// Fixture overlay: the user-owned handler the "locked articles" scenario relies on.
import { eq } from "drizzle-orm";
import type { ActionContext } from "@generated/actions";
import { articles, type Article } from "@generated/db/schema";
import type { PostsLockInput } from "@generated/validation";

export async function handler(ctx: ActionContext<PostsLockInput, Article>): Promise<Article> {
  const [row] = await ctx.db.update(articles).set({ locked: true }).where(eq(articles.id, ctx.row.id)).returning();
  return row;
}
