-- OSL migration 7: FEAT-7 (Admins ban users through an action that sets read_only fields; role is read_only too; users edit their own name)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "users" ADD COLUMN "banned" boolean NOT NULL DEFAULT false;

ALTER TABLE "users" ADD COLUMN "banned_at" timestamp with time zone;

ALTER TABLE "users" ADD COLUMN "ban_reason" text;
