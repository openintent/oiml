// Fixture overlay: the user-owned handler the "completing tasks" scenario relies on.
import { eq } from "drizzle-orm";
import type { ActionContext } from "@/generated/actions";
import { tasks, type Task } from "@/generated/db/schema";
import type { TasksCompleteInput } from "@/generated/validation";

export async function handler(ctx: ActionContext<TasksCompleteInput, Task>): Promise<Task> {
  const [row] = await ctx.db.update(tasks).set({ status: "done" }).where(eq(tasks.id, ctx.row.id)).returning();
  return row;
}
