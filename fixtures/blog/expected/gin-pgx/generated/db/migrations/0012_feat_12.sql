-- OSL migration 12: FEAT-12 (Follows between users and bulletins readable by the author's followers, through a membership relation with two identity relations)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "follows" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "follower_id" uuid NOT NULL,
  "followee_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "follows_follower_id_followee_id_key" UNIQUE ("follower_id", "followee_id")
);

CREATE TABLE "bulletins" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "author_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users" ("id") ON DELETE CASCADE;

ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_fkey" FOREIGN KEY ("followee_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "follows_follower_id_idx" ON "follows" ("follower_id");

CREATE INDEX "follows_followee_id_idx" ON "follows" ("followee_id");

ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "bulletins_author_id_idx" ON "bulletins" ("author_id");
