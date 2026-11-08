-- OSL migration 1: FEAT-1 (User entity, credentials auth, users resource, example actors)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "user_role" AS ENUM ('member', 'admin');

CREATE TABLE "users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "email" varchar(255) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "role" "user_role" NOT NULL DEFAULT 'member',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "password_hash" varchar(255),
  PRIMARY KEY ("id")
);
