-- OSL migration 1: WS-1 (Users, teams, memberships with roles, projects scoped to teams, credentials auth with tenancy)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "team_member_role" AS ENUM ('owner', 'admin', 'member');

CREATE TYPE "project_status" AS ENUM ('active', 'archived');

CREATE TABLE "users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "email" varchar(255) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "password_hash" varchar(255),
  PRIMARY KEY ("id")
);

CREATE TABLE "teams" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" varchar(100) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "team_members" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" "team_member_role" NOT NULL DEFAULT 'member',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "team_members_team_id_user_id_key" UNIQUE ("team_id", "user_id")
);

CREATE TABLE "projects" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "name" varchar(120) NOT NULL,
  "status" "project_status" NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE CASCADE;

ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "team_members_team_id_idx" ON "team_members" ("team_id");

CREATE INDEX "team_members_user_id_idx" ON "team_members" ("user_id");

ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE CASCADE;

CREATE INDEX "projects_team_id_idx" ON "projects" ("team_id");
