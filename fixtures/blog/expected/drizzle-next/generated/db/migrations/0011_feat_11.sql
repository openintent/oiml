-- OSL migration 11: FEAT-11 (Announcements whose drafts answer not found to everyone but the author and admins; publish is a row action)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "announcements" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "title" varchar(200) NOT NULL,
  "body" text NOT NULL,
  "published" boolean NOT NULL DEFAULT false,
  "author_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "announcements_author_id_idx" ON "announcements" ("author_id");
