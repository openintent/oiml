-- OSL migration 19: FEAT-19 (Attachment under Article with a required file, an attachments resource, and a section on the article page whose create form takes the file)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "attachments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "article_id" uuid NOT NULL,
  "uploader_id" uuid NOT NULL,
  "title" varchar(120) NOT NULL,
  "file" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles" ("id") ON DELETE CASCADE;

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "attachments_article_id_idx" ON "attachments" ("article_id");

CREATE INDEX "attachments_uploader_id_idx" ON "attachments" ("uploader_id");
