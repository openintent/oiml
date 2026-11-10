-- OSL migration 18: FEAT-18 (Integration with a config whose shape follows kind (shape_by), a sealed secret nobody reads back and a sealed token for its owner; User.preferences with a shape and a sealed User.recovery_code; a sign action whose handler opens the secret, and an event that would fail on a sealed value; an integration page at /integrations/:id)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "integration_kind" AS ENUM ('webhook', 'slack', 'email');

CREATE TABLE "integrations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "owner_id" uuid NOT NULL,
  "name" varchar(80) NOT NULL,
  "kind" "integration_kind" NOT NULL,
  "config" jsonb NOT NULL,
  "secret" bytea,
  "token" bytea,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "users" ADD COLUMN "preferences" jsonb;

ALTER TABLE "users" ADD COLUMN "recovery_code" bytea;

ALTER TABLE "integrations" ADD CONSTRAINT "integrations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "integrations_owner_id_idx" ON "integrations" ("owner_id");
