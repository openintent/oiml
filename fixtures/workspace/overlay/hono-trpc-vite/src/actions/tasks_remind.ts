// Fixture overlay: the user-owned handler the "due reminders" scenario relies on.
import { eq } from "drizzle-orm";
import type { ActionContext } from "@generated/actions";
import { tasks, users, type Task } from "@generated/db/schema";
import { sendEmail } from "@generated/email";
import type { TasksRemindInput } from "@generated/validation";

export async function handler(ctx: ActionContext<TasksRemindInput, Task>): Promise<Task> {
  if (ctx.row.reminded_at || !ctx.row.assignee_id) return ctx.row;
  const [assignee] = await ctx.db.select().from(users).where(eq(users.id, ctx.row.assignee_id));
  if (assignee) {
    await sendEmail({ to: assignee.email, subject: `Reminder: ${ctx.row.title}`, text: `${ctx.row.title} is due.` });
  }
  const [row] = await ctx.db.update(tasks).set({ reminded_at: ctx.now }).where(eq(tasks.id, ctx.row.id)).returning();
  return row;
}
