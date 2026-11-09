// Fixture overlay: the user-owned handler the "locked articles" scenario relies on.
import { eq } from "drizzle-orm";
import type { ActionContext } from "@generated/actions";
import { articles, type Article } from "@generated/db/schema";
import type { PostsUnlockInput } from "@generated/validation";

export async function handler(ctx: ActionContext<PostsUnlockInput, Article>): Promise<Article> {
  const [row] = await ctx.db.update(articles).set({ locked: false }).where(eq(articles.id, ctx.row.id)).returning();
  return row;
}
