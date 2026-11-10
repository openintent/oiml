-- OSL migration 8: TODO-8 (Task status is a state machine (start, pause, finish with completed_at) beside the complete action, clients no longer write it, and the board drags along the transitions)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "tasks" ADD COLUMN "completed_at" timestamp with time zone;
