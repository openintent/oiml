// Fixture overlay: the user-owned handler the "private and public channels" scenario relies on.
import { and, eq } from "drizzle-orm";
import type { ActionContext } from "@/generated/actions";
import { channelMembers, type Channel } from "@/generated/db/schema";
import { fail } from "@/generated/http";
import type { ChannelsJoinInput } from "@/generated/validation";

/** Adds the caller to the channel as a member; joining a channel they already belong to is a conflict. */
export async function handler(ctx: ActionContext<ChannelsJoinInput, Channel>): Promise<Channel> {
  const userId = ctx.session!.user.id;
  const [existing] = await ctx.db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(and(eq(channelMembers.channel_id, ctx.row.id), eq(channelMembers.user_id, userId)));
  if (existing) fail(409, "conflict", "Already a member of this channel");
  await ctx.db.insert(channelMembers).values({ channel_id: ctx.row.id, user_id: userId, role: "member" });
  return ctx.row;
}
