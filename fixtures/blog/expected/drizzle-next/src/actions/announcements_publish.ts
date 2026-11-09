// Created once by OSL (@osl/backend-drizzle-next). Publish the announcement. POST /api/announcements/{id}/publish: ctx.row is the Announcement; return the row to answer with it.
// You own this file: OSL never rewrites it.

import type { ActionContext } from "@/generated/actions";
import type { Announcement } from "@/generated/db/schema";
import type { AnnouncementsPublishInput } from "@/generated/validation";

// Throw an error from "@/generated/http" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<AnnouncementsPublishInput, Announcement>): Promise<Announcement> {
  return ctx.row;
}
