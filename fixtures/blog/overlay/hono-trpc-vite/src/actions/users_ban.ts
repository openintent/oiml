// Fixture overlay: the user-owned handler the "banning" scenario relies on.
import { eq } from "drizzle-orm";
import type { ActionContext } from "@generated/actions";
import { users, type User } from "@generated/db/schema";
import type { UsersBanInput } from "@generated/validation";

export async function handler(ctx: ActionContext<UsersBanInput, User>): Promise<User> {
  const [row] = await ctx.db
    .update(users)
    .set({ banned: true, banned_at: new Date(), ban_reason: ctx.input.reason })
    .where(eq(users.id, ctx.row.id))
    .returning();
  return row;
}
