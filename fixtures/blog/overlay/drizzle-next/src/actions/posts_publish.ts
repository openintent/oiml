// Fixture overlay: the user-owned handler the "publishing" scenario relies on.
import { eq } from "drizzle-orm";
import type { ActionContext } from "@/generated/actions";
import { articles, type Article } from "@/generated/db/schema";
import type { PostsPublishInput } from "@/generated/validation";

export async function handler(ctx: ActionContext<PostsPublishInput, Article>): Promise<Article> {
  const [row] = await ctx.db.update(articles).set({ published: true }).where(eq(articles.id, ctx.row.id)).returning();
  return row;
}
