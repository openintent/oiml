-- OSL migration 8: WS-9 (Channels in a team with their own membership (member through a membership relation, ranked channel roles), public channels joined by any team member, messages bound to their author)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "channel_member_role" AS ENUM ('admin', 'member');

CREATE TABLE "channels" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "created_by" uuid NOT NULL,
  "name" varchar(80) NOT NULL,
  "private" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "channels_team_id_name_key" UNIQUE ("team_id", "name")
);

CREATE TABLE "channel_members" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "channel_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" "channel_member_role" NOT NULL DEFAULT 'member',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "channel_members_channel_id_user_id_key" UNIQUE ("channel_id", "user_id")
);

CREATE TABLE "messages" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "channel_id" uuid NOT NULL,
  "author_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "channels" ADD CONSTRAINT "channels_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE CASCADE;

ALTER TABLE "channels" ADD CONSTRAINT "channels_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "channels_team_id_idx" ON "channels" ("team_id");

CREATE INDEX "channels_created_by_idx" ON "channels" ("created_by");

ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels" ("id") ON DELETE CASCADE;

ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "channel_members_channel_id_idx" ON "channel_members" ("channel_id");

CREATE INDEX "channel_members_user_id_idx" ON "channel_members" ("user_id");

ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels" ("id") ON DELETE CASCADE;

ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "messages_channel_id_idx" ON "messages" ("channel_id");

CREATE INDEX "messages_author_id_idx" ON "messages" ("author_id");
