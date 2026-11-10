-- OSL migration 16: WS-17 (read: on fields: Project.budget and Team.pending_requests for the team's admins, Task.estimate for signed-in callers; the projects table gains a budget column only its readers get, and a public share page per task shows the estimate only to them)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "projects" ADD COLUMN "budget" integer;

ALTER TABLE "tasks" ADD COLUMN "estimate" integer;
