// Created once by OSL (@osl/backend-drizzle-next). Handler post_archived, run on posts.archive as a background job.
// You own this file: OSL never rewrites it.

import type { EventPayloads } from "@/generated/events";

export async function handler(payload: EventPayloads["posts.archive"]): Promise<void> {
  // Runs after the posts.archive action ran. Replace this with your logic.
  void payload;
}
