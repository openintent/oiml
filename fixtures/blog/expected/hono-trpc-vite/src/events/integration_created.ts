// Created once by OSL (@osl/backend-hono-trpc-vite). Handler integration_created, run on Integration.created.
// You own this file: OSL never rewrites it.

import type { EventPayloads } from "@generated/events";

export async function handler(payload: EventPayloads["Integration.created"]): Promise<void> {
  // Runs after Integration is created. Replace this with your logic.
  void payload;
}
