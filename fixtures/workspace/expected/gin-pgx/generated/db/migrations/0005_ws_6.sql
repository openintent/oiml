-- OSL migration 5: WS-6 (Tasks carry a due time; a timer emails the assignee once when it passes, unless the task is done)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "tasks" ADD COLUMN "due_at" timestamp with time zone;

ALTER TABLE "tasks" ADD COLUMN "reminded_at" timestamp with time zone;
