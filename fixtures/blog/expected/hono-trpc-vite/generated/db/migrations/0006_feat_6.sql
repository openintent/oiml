-- OSL migration 6: FEAT-6 (Comments on articles, deletable by their author, the article's author or an admin; admins moderate articles)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "comments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "body" text NOT NULL,
  "article_id" uuid NOT NULL,
  "author_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "comments" ADD CONSTRAINT "comments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles" ("id") ON DELETE CASCADE;

ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "comments_article_id_idx" ON "comments" ("article_id");

CREATE INDEX "comments_author_id_idx" ON "comments" ("author_id");
