-- OSL migration 2: WS-2 (Magic link provider, sidebar app with team, project and member pages)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "osl_auth_token_purpose" AS ENUM ('magic_link');

CREATE TABLE "osl_auth_tokens" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "token_hash" varchar(255) NOT NULL UNIQUE,
  "email" varchar(255) NOT NULL,
  "purpose" "osl_auth_token_purpose" NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
