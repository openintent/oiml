-- OSL migration 13: WS-15 (read: on fields: Project.budget and Team.pending_requests for the team's admins, Task.estimate for signed-in callers; the projects table gains a budget column only its readers get)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "projects" ADD COLUMN "budget" integer;

ALTER TABLE "tasks" ADD COLUMN "estimate" integer;
