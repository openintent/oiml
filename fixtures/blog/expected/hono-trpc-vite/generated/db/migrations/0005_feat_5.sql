-- OSL migration 5: FEAT-5 (Publish and admin-only digest and unpublish actions, an admin actor, cover files, sortable searchable lists, magic link and GitHub sign-in, overview and archive pages, a queued event, seed data)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "osl_file_status" AS ENUM ('pending', 'ready');

CREATE TYPE "osl_auth_token_purpose" AS ENUM ('magic_link');

CREATE TABLE "osl_files" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "key" varchar(500) NOT NULL UNIQUE,
  "name" varchar(255) NOT NULL,
  "size" integer NOT NULL,
  "type" varchar(255) NOT NULL,
  "status" "osl_file_status" NOT NULL DEFAULT 'pending',
  "owner_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "osl_auth_tokens" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "token_hash" varchar(255) NOT NULL UNIQUE,
  "email" varchar(255) NOT NULL,
  "purpose" "osl_auth_token_purpose" NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "osl_auth_states" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "state_hash" varchar(255) NOT NULL UNIQUE,
  "provider" varchar(50) NOT NULL,
  "code_verifier" varchar(255),
  "nonce" varchar(255),
  "redirect_to" varchar(500),
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "osl_auth_accounts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "provider" varchar(50) NOT NULL,
  "provider_account_id" varchar(255) NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "osl_auth_accounts_provider_provider_account_id_key" UNIQUE ("provider", "provider_account_id")
);

ALTER TABLE "articles" ADD COLUMN "cover" jsonb;

ALTER TABLE "osl_files" ADD CONSTRAINT "osl_files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE SET NULL;

CREATE INDEX "osl_files_owner_id_idx" ON "osl_files" ("owner_id");

ALTER TABLE "osl_auth_accounts" ADD CONSTRAINT "osl_auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "osl_auth_accounts_user_id_idx" ON "osl_auth_accounts" ("user_id");
