-- OSL migration 3: FEAT-3 (Rename Post to Article and created_at to posted_at, add tags)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "posts" RENAME TO "articles";

ALTER TABLE "articles" RENAME COLUMN "created_at" TO "posted_at";

ALTER TABLE "articles" ADD COLUMN "tags" varchar(255)[];

ALTER TABLE "articles" DROP CONSTRAINT IF EXISTS "posts_author_id_fkey";

ALTER TABLE "articles" DROP CONSTRAINT IF EXISTS "posts_author_id_title_key";

DROP INDEX IF EXISTS "posts_author_id_idx";

ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE;

ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_title_key" UNIQUE ("author_id", "title");

CREATE INDEX "articles_author_id_idx" ON "articles" ("author_id");
