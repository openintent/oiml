// Created once by OSL (@osl/backend-hono-trpc-vite). Mark the task done. POST /api/tasks/{id}/complete: ctx.row is the Task; return the row to answer with it.
// You own this file: OSL never rewrites it.

import type { ActionContext } from "@generated/actions";
import type { Task } from "@generated/db/schema";
import type { TasksCompleteInput } from "@generated/validation";

// Throw an error from "@generated/server/errors" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<TasksCompleteInput, Task>): Promise<Task> {
  return ctx.row;
}
