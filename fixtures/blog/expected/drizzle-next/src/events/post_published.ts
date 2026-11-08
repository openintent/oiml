// Created once by OSL (@osl/backend-drizzle-next). Handler post_published, run on posts.publish as a background job.
// You own this file: OSL never rewrites it.

import type { EventPayloads } from "@/generated/events";

export async function handler(payload: EventPayloads["posts.publish"]): Promise<void> {
  // Runs after the posts.publish action ran. Replace this with your logic.
  void payload;
}
