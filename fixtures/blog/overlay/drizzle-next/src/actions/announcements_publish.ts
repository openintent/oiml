// Fixture overlay: the user-owned handler the "private drafts" scenario relies on.
import { eq } from "drizzle-orm";
import type { ActionContext } from "@/generated/actions";
import { announcements, type Announcement } from "@/generated/db/schema";
import type { AnnouncementsPublishInput } from "@/generated/validation";

export async function handler(ctx: ActionContext<AnnouncementsPublishInput, Announcement>): Promise<Announcement> {
  const [row] = await ctx.db
    .update(announcements)
    .set({ published: true })
    .where(eq(announcements.id, ctx.row.id))
    .returning();
  return row;
}
