// Fixture overlay: the event handler the "integrations and sealed secrets" scenario relies on.
import type { EventPayloads } from "@generated/events";

/**
 * Fails when the payload carries a sealed field: the create it follows then answers 500 and the scenario fails.
 * An event's payload is the row as the server reads it, and the server never reads a sealed value.
 */
export async function handler(payload: EventPayloads["Integration.created"]): Promise<void> {
  if ("secret" in payload || "token" in payload) throw new Error("a sealed field reached an event payload");
}
