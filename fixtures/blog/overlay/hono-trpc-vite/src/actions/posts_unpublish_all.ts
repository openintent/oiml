// Fixture overlay: the user-owned handler the "publishing" scenario relies on.
import { eq } from "drizzle-orm";
import type { ActionContext } from "@generated/actions";
import { articles } from "@generated/db/schema";
import type { PostsUnpublishAllInput } from "@generated/validation";

export async function handler(ctx: ActionContext<PostsUnpublishAllInput, undefined>): Promise<{ count: number }> {
  const rows = await ctx.db.update(articles).set({ published: false }).where(eq(articles.published, true)).returning();
  return { count: rows.length };
}
