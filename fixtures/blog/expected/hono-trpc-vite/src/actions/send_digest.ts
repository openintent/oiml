// Created once by OSL (@osl/backend-hono-trpc-vite). Email a digest of recent articles. POST /api/actions/send_digest.
// You own this file: OSL never rewrites it.

import type { ActionContext } from "@generated/actions";

import type { SendDigestInput } from "@generated/validation";

// Throw an error from "@generated/server/errors" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<SendDigestInput, undefined>): Promise<{ sent: number }> {
  void ctx;
  return { sent: 0 };
}
