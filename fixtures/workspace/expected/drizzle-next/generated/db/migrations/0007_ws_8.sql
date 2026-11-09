-- OSL migration 7: WS-8 (Milestones on projects, team-only through the project, with hidden rows answered as not found)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "milestones" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "title" varchar(200) NOT NULL,
  "due_on" date NOT NULL,
  "done" boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("id")
);

ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;

CREATE INDEX "milestones_project_id_idx" ON "milestones" ("project_id");
