// Created once by OSL (@osl/backend-drizzle-next). Handler post_created, run on Article.created.
// You own this file: OSL never rewrites it.

import type { EventPayloads } from "@/generated/events";

export async function handler(payload: EventPayloads["Article.created"]): Promise<void> {
  // Runs after Article is created. Replace this with your logic.
  void payload;
}
