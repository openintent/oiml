// Created once by OSL (@osl/backend-hono-trpc-vite). Join. POST /api/channels/{id}/join: ctx.row is the Channel; return the row to answer with it.
// You own this file: OSL never rewrites it.

import type { ActionContext } from "@generated/actions";
import type { Channel } from "@generated/db/schema";
import type { ChannelsJoinInput } from "@generated/validation";

// Throw an error from "@generated/server/errors" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<ChannelsJoinInput, Channel>): Promise<Channel> {
  return ctx.row;
}
