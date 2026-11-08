-- OSL migration 2: FEAT-2 (Post entity owned by its author, posts resource, created event, scenarios)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "posts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "title" varchar(200) NOT NULL,
  "content" text NOT NULL,
  "published" boolean NOT NULL DEFAULT false,
  "author_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "posts_author_id_title_key" UNIQUE ("author_id", "title")
);

ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "posts_author_id_idx" ON "posts" ("author_id");
