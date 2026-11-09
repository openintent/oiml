// Created once by OSL (@osl/backend-hono-trpc-vite). Ban the user, recording when and why. POST /api/users/{id}/ban: ctx.row is the User; return the row to answer with it.
// You own this file: OSL never rewrites it.

import type { ActionContext } from "@generated/actions";
import type { User } from "@generated/db/schema";
import type { UsersBanInput } from "@generated/validation";

// Throw an error from "@generated/server/errors" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<UsersBanInput, User>): Promise<User> {
  return ctx.row;
}
