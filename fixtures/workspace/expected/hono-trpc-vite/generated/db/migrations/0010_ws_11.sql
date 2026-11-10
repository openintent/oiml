-- OSL migration 10: WS-11 (Invites into a team's membership: the TeamInvite entity and its team_invites resource written by the compiler, the token routes, and a page of the current team's pending invites)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "team_invite_role" AS ENUM ('owner', 'admin', 'member');

CREATE TABLE "team_invites" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "email" varchar(255) NOT NULL,
  "role" "team_invite_role" NOT NULL DEFAULT 'member',
  "invited_by" uuid NOT NULL,
  "token_hash" varchar(255) NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "team_invites_team_id_email_key" UNIQUE ("team_id", "email")
);

ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE CASCADE;

ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "team_invites_team_id_idx" ON "team_invites" ("team_id");

CREATE INDEX "team_invites_invited_by_idx" ON "team_invites" ("invited_by");
