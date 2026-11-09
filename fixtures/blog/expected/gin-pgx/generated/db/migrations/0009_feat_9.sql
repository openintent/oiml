-- OSL migration 9: FEAT-9 (Articles publish themselves at publish_at through a timer; the digest runs every morning on a schedule)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "articles" ADD COLUMN "publish_at" timestamp with time zone;
