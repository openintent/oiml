-- OSL migration 2: TODO-2 (Label entity, TaskLabel junction with a composite key, one-to-one TaskNote)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "labels" (
  "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name" varchar(40) NOT NULL UNIQUE,
  PRIMARY KEY ("id")
);

CREATE TABLE "task_labels" (
  "task_id" integer NOT NULL,
  "label_id" integer NOT NULL,
  PRIMARY KEY ("task_id", "label_id")
);

CREATE TABLE "task_notes" (
  "id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "task_id" integer NOT NULL UNIQUE,
  "body" text NOT NULL,
  PRIMARY KEY ("id")
);

ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE;

ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels" ("id") ON DELETE CASCADE;

CREATE INDEX "task_labels_task_id_idx" ON "task_labels" ("task_id");

CREATE INDEX "task_labels_label_id_idx" ON "task_labels" ("label_id");

ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE;
