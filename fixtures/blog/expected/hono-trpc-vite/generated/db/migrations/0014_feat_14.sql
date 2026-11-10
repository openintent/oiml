-- OSL migration 14: FEAT-14 (Co-authors: the ArticleEditor junction, editors may update the article, and invites into it, kept by the compiler as ArticleInvite behind article_invites)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "article_editors" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "article_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "article_editors_article_id_user_id_key" UNIQUE ("article_id", "user_id")
);

CREATE TABLE "article_invites" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "article_id" uuid NOT NULL,
  "email" varchar(255) NOT NULL,
  "invited_by" uuid NOT NULL,
  "token_hash" varchar(255) NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "article_invites_article_id_email_key" UNIQUE ("article_id", "email")
);

ALTER TABLE "article_editors" ADD CONSTRAINT "article_editors_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles" ("id") ON DELETE CASCADE;

ALTER TABLE "article_editors" ADD CONSTRAINT "article_editors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "article_editors_article_id_idx" ON "article_editors" ("article_id");

CREATE INDEX "article_editors_user_id_idx" ON "article_editors" ("user_id");

ALTER TABLE "article_invites" ADD CONSTRAINT "article_invites_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles" ("id") ON DELETE CASCADE;

ALTER TABLE "article_invites" ADD CONSTRAINT "article_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "article_invites_article_id_idx" ON "article_invites" ("article_id");

CREATE INDEX "article_invites_invited_by_idx" ON "article_invites" ("invited_by");
