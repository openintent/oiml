-- OSL migration 11: WS-12 (Invites into a channel's membership beside the team's: the ChannelInvite entity and its channel_invites resource written by the compiler, and an Invites section on the channel page)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "channel_invite_role" AS ENUM ('admin', 'member');

CREATE TABLE "channel_invites" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "channel_id" uuid NOT NULL,
  "email" varchar(255) NOT NULL,
  "role" "channel_invite_role" NOT NULL DEFAULT 'member',
  "invited_by" uuid NOT NULL,
  "token_hash" varchar(255) NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "channel_invites_channel_id_email_key" UNIQUE ("channel_id", "email")
);

ALTER TABLE "channel_invites" ADD CONSTRAINT "channel_invites_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels" ("id") ON DELETE CASCADE;

ALTER TABLE "channel_invites" ADD CONSTRAINT "channel_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "channel_invites_channel_id_idx" ON "channel_invites" ("channel_id");

CREATE INDEX "channel_invites_invited_by_idx" ON "channel_invites" ("invited_by");
