// Created once by OSL (@osl/backend-hono-trpc-vite). Handler post_approved, run on posts.approve.
// You own this file: OSL never rewrites it.

import type { EventPayloads } from "@generated/events";

export async function handler(payload: EventPayloads["posts.approve"]): Promise<void> {
  // Runs after the posts.approve action ran. Replace this with your logic.
  void payload;
}
