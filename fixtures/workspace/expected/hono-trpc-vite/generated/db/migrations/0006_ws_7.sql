-- OSL migration 6: WS-7 (A public project opens its tasks to everyone through a condition on the project; notes need membership and bind their author)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "notes" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "author_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "projects" ADD COLUMN "public" boolean NOT NULL DEFAULT false;

ALTER TABLE "notes" ADD CONSTRAINT "notes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;

ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "notes_project_id_idx" ON "notes" ("project_id");

CREATE INDEX "notes_author_id_idx" ON "notes" ("author_id");
