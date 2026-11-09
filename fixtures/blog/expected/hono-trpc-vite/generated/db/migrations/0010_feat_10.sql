-- OSL migration 10: FEAT-10 (Admins lock and unlock articles through actions on a read_only flag; a comment's create rule reads the flag through article_id)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "articles" ADD COLUMN "locked" boolean NOT NULL DEFAULT false;
