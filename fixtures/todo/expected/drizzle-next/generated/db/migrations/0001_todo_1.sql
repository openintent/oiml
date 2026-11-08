-- OSL migration 1: TODO-1 (Project and Task with integer keys, enum status, decimal estimate, set-null project link)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "task_status" AS ENUM ('todo', 'doing', 'done');

CREATE TABLE "projects" (
  "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name" varchar(120) NOT NULL UNIQUE,
  "color" varchar(7),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "tasks" (
  "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "title" varchar(200) NOT NULL,
  "status" "task_status" NOT NULL DEFAULT 'todo',
  "estimate_hours" numeric,
  "due_on" date,
  "assignee" varchar(80),
  "project_id" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL;

CREATE INDEX "tasks_status_idx" ON "tasks" ("status");

CREATE INDEX "tasks_project_id_idx" ON "tasks" ("project_id");
