-- OSL migration 15: FEAT-15 (read: on fields: User.phone and User.banned_at for the person and the admins, Article.editor_note for admins; users can set their phone, the users table gains the column for those who may read it)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "users" ADD COLUMN "phone" varchar(40);

ALTER TABLE "articles" ADD COLUMN "editor_note" text;
