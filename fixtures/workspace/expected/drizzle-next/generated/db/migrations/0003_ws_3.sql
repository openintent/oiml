-- OSL migration 3: WS-3 (Tasks in projects, ruled through the project's team; assignees see and update their own)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "tasks" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "title" varchar(200) NOT NULL,
  "done" boolean NOT NULL DEFAULT false,
  "assignee_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users" ("id") ON DELETE SET NULL;

CREATE INDEX "tasks_project_id_idx" ON "tasks" ("project_id");

CREATE INDEX "tasks_assignee_id_idx" ON "tasks" ("assignee_id");
