// Created once by OSL (@osl/backend-drizzle-next). Email the assignee about the task. POST /api/tasks/{id}/remind: ctx.row is the Task; return the row to answer with it.
// You own this file: OSL never rewrites it.

import type { ActionContext } from "@/generated/actions";
import type { Task } from "@/generated/db/schema";
import type { TasksRemindInput } from "@/generated/validation";

// Throw an error from "@/generated/http" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<TasksRemindInput, Task>): Promise<Task> {
  return ctx.row;
}
