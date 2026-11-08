// Fixture overlay: the user-owned handler the "completing tasks" scenario relies on.
import { eq } from "drizzle-orm";
import type { ActionContext } from "@/generated/actions";
import { tasks } from "@/generated/db/schema";
import type { TasksClearDoneInput } from "@/generated/validation";

export async function handler(ctx: ActionContext<TasksClearDoneInput, undefined>): Promise<{ count: number }> {
  const rows = await ctx.db.delete(tasks).where(eq(tasks.status, "done")).returning();
  return { count: rows.length };
}
