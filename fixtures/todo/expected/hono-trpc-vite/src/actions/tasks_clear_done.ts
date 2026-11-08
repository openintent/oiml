// Created once by OSL (@osl/backend-hono-trpc-vite). Delete every task that is done. POST /api/tasks/clear_done, over the whole collection.
// You own this file: OSL never rewrites it.

import type { ActionContext } from "@generated/actions";

import type { TasksClearDoneInput } from "@generated/validation";

// Throw an error from "@generated/server/errors" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<TasksClearDoneInput, undefined>): Promise<{ count: number }> {
  void ctx;
  return { count: 0 };
}
