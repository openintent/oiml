-- OSL migration 12: WS-13 (Tenant isolation in the database: row-level security on every team table behind the rules, so an assignee who left the team no longer reaches its tasks)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "tasks" ADD COLUMN "team_id" uuid;

ALTER TABLE "notes" ADD COLUMN "team_id" uuid;

ALTER TABLE "milestones" ADD COLUMN "team_id" uuid;

ALTER TABLE "channel_members" ADD COLUMN "team_id" uuid;

ALTER TABLE "messages" ADD COLUMN "team_id" uuid;

ALTER TABLE "channel_invites" ADD COLUMN "team_id" uuid;

UPDATE "tasks" AS child SET "team_id" = parent."team_id" FROM "projects" AS parent WHERE parent."id" = child."project_id";

ALTER TABLE "tasks" ALTER COLUMN "team_id" SET NOT NULL;

UPDATE "notes" AS child SET "team_id" = parent."team_id" FROM "projects" AS parent WHERE parent."id" = child."project_id";

ALTER TABLE "notes" ALTER COLUMN "team_id" SET NOT NULL;

UPDATE "milestones" AS child SET "team_id" = parent."team_id" FROM "projects" AS parent WHERE parent."id" = child."project_id";

ALTER TABLE "milestones" ALTER COLUMN "team_id" SET NOT NULL;

UPDATE "channel_members" AS child SET "team_id" = parent."team_id" FROM "channels" AS parent WHERE parent."id" = child."channel_id";

ALTER TABLE "channel_members" ALTER COLUMN "team_id" SET NOT NULL;

UPDATE "messages" AS child SET "team_id" = parent."team_id" FROM "channels" AS parent WHERE parent."id" = child."channel_id";

ALTER TABLE "messages" ALTER COLUMN "team_id" SET NOT NULL;

UPDATE "channel_invites" AS child SET "team_id" = parent."team_id" FROM "channels" AS parent WHERE parent."id" = child."channel_id";

ALTER TABLE "channel_invites" ALTER COLUMN "team_id" SET NOT NULL;

ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_id_key" UNIQUE ("team_id", "id");

CREATE INDEX "tasks_team_id_idx" ON "tasks" ("team_id");

CREATE INDEX "notes_team_id_idx" ON "notes" ("team_id");

CREATE INDEX "milestones_team_id_idx" ON "milestones" ("team_id");

ALTER TABLE "channels" ADD CONSTRAINT "channels_team_id_id_key" UNIQUE ("team_id", "id");

CREATE INDEX "channel_members_team_id_idx" ON "channel_members" ("team_id");

CREATE INDEX "messages_team_id_idx" ON "messages" ("team_id");

CREATE INDEX "channel_invites_team_id_idx" ON "channel_invites" ("team_id");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_project_id_fkey" FOREIGN KEY ("team_id", "project_id") REFERENCES "projects" ("team_id", "id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "notes" ADD CONSTRAINT "notes_team_id_project_id_fkey" FOREIGN KEY ("team_id", "project_id") REFERENCES "projects" ("team_id", "id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "milestones" ADD CONSTRAINT "milestones_team_id_project_id_fkey" FOREIGN KEY ("team_id", "project_id") REFERENCES "projects" ("team_id", "id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_team_id_channel_id_fkey" FOREIGN KEY ("team_id", "channel_id") REFERENCES "channels" ("team_id", "id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "messages" ADD CONSTRAINT "messages_team_id_channel_id_fkey" FOREIGN KEY ("team_id", "channel_id") REFERENCES "channels" ("team_id", "id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "channel_invites" ADD CONSTRAINT "channel_invites_team_id_channel_id_fkey" FOREIGN KEY ("team_id", "channel_id") REFERENCES "channels" ("team_id", "id") ON UPDATE CASCADE ON DELETE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'workspace_app') THEN
    CREATE ROLE "workspace_app" NOLOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "teams" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "team_members" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "projects" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "tasks" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "notes" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "milestones" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "channels" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "channel_members" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "messages" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "team_invites" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "channel_invites" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "osl_auth_tokens" TO "workspace_app";

CREATE FUNCTION "osl_memberships"(uuid) RETURNS TABLE (tenant uuid, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT "team_id", "role"::text FROM "team_members" WHERE "user_id" = $1
$$;

REVOKE ALL ON FUNCTION "osl_memberships"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_memberships"(uuid) TO "workspace_app";

CREATE FUNCTION "osl_invite_team_invites"(text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT "team_id" FROM "team_invites" WHERE "token_hash" = $1
$$;

REVOKE ALL ON FUNCTION "osl_invite_team_invites"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_invite_team_invites"(text) TO "workspace_app";

CREATE FUNCTION "osl_invites_team_invites"(text, timestamptz) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT "team_id" FROM "team_invites" WHERE "email" = $1 AND "expires_at" > $2
$$;

REVOKE ALL ON FUNCTION "osl_invites_team_invites"(text, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_invites_team_invites"(text, timestamptz) TO "workspace_app";

CREATE FUNCTION "osl_invite_channel_invites"(text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT "team_id" FROM "channel_invites" WHERE "token_hash" = $1
$$;

REVOKE ALL ON FUNCTION "osl_invite_channel_invites"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_invite_channel_invites"(text) TO "workspace_app";

CREATE FUNCTION "osl_invites_channel_invites"(text, timestamptz) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT "team_id" FROM "channel_invites" WHERE "email" = $1 AND "expires_at" > $2
$$;

REVOKE ALL ON FUNCTION "osl_invites_channel_invites"(text, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_invites_channel_invites"(text, timestamptz) TO "workspace_app";

CREATE FUNCTION "osl_exists_teams"(uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "teams" WHERE "id" = $1)
$$;

REVOKE ALL ON FUNCTION "osl_exists_teams"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_exists_teams"(uuid) TO "workspace_app";

CREATE FUNCTION "osl_exists_team_members"(uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "team_members" WHERE "id" = $1)
$$;

REVOKE ALL ON FUNCTION "osl_exists_team_members"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_exists_team_members"(uuid) TO "workspace_app";

CREATE FUNCTION "osl_exists_projects"(uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "projects" WHERE "id" = $1)
$$;

REVOKE ALL ON FUNCTION "osl_exists_projects"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_exists_projects"(uuid) TO "workspace_app";

CREATE FUNCTION "osl_exists_tasks"(uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "tasks" WHERE "id" = $1)
$$;

REVOKE ALL ON FUNCTION "osl_exists_tasks"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_exists_tasks"(uuid) TO "workspace_app";

CREATE FUNCTION "osl_read_tasks_project_id_public"(uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT "public" FROM "projects" WHERE "id" = $1
$$;

REVOKE ALL ON FUNCTION "osl_read_tasks_project_id_public"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_read_tasks_project_id_public"(uuid) TO "workspace_app";

CREATE FUNCTION "osl_tenant_tasks"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."project_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "team_id" INTO NEW."team_id" FROM "projects" WHERE "id" = NEW."project_id";
  IF NOT FOUND THEN RAISE foreign_key_violation USING MESSAGE = 'tasks.project_id names a row of projects that does not exist'; END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION "osl_tenant_tasks"() FROM PUBLIC;

CREATE FUNCTION "osl_exists_notes"(uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "notes" WHERE "id" = $1)
$$;

REVOKE ALL ON FUNCTION "osl_exists_notes"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_exists_notes"(uuid) TO "workspace_app";

CREATE FUNCTION "osl_tenant_notes"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."project_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "team_id" INTO NEW."team_id" FROM "projects" WHERE "id" = NEW."project_id";
  IF NOT FOUND THEN RAISE foreign_key_violation USING MESSAGE = 'notes.project_id names a row of projects that does not exist'; END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION "osl_tenant_notes"() FROM PUBLIC;

CREATE FUNCTION "osl_tenant_milestones"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."project_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "team_id" INTO NEW."team_id" FROM "projects" WHERE "id" = NEW."project_id";
  IF NOT FOUND THEN RAISE foreign_key_violation USING MESSAGE = 'milestones.project_id names a row of projects that does not exist'; END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION "osl_tenant_milestones"() FROM PUBLIC;

CREATE FUNCTION "osl_exists_channel_members"(uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "channel_members" WHERE "id" = $1)
$$;

REVOKE ALL ON FUNCTION "osl_exists_channel_members"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_exists_channel_members"(uuid) TO "workspace_app";

CREATE FUNCTION "osl_tenant_channel_members"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."channel_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "team_id" INTO NEW."team_id" FROM "channels" WHERE "id" = NEW."channel_id";
  IF NOT FOUND THEN RAISE foreign_key_violation USING MESSAGE = 'channel_members.channel_id names a row of channels that does not exist'; END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION "osl_tenant_channel_members"() FROM PUBLIC;

CREATE FUNCTION "osl_tenant_messages"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."channel_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "team_id" INTO NEW."team_id" FROM "channels" WHERE "id" = NEW."channel_id";
  IF NOT FOUND THEN RAISE foreign_key_violation USING MESSAGE = 'messages.channel_id names a row of channels that does not exist'; END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION "osl_tenant_messages"() FROM PUBLIC;

CREATE FUNCTION "osl_exists_team_invites"(uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "team_invites" WHERE "id" = $1)
$$;

REVOKE ALL ON FUNCTION "osl_exists_team_invites"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_exists_team_invites"(uuid) TO "workspace_app";

CREATE FUNCTION "osl_tenant_channel_invites"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."channel_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "team_id" INTO NEW."team_id" FROM "channels" WHERE "id" = NEW."channel_id";
  IF NOT FOUND THEN RAISE foreign_key_violation USING MESSAGE = 'channel_invites.channel_id names a row of channels that does not exist'; END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION "osl_tenant_channel_invites"() FROM PUBLIC;

CREATE TRIGGER "osl_tenant" BEFORE INSERT OR UPDATE OF "project_id" ON "tasks" FOR EACH ROW EXECUTE FUNCTION "osl_tenant_tasks"();

CREATE TRIGGER "osl_tenant" BEFORE INSERT OR UPDATE OF "project_id" ON "notes" FOR EACH ROW EXECUTE FUNCTION "osl_tenant_notes"();

CREATE TRIGGER "osl_tenant" BEFORE INSERT OR UPDATE OF "project_id" ON "milestones" FOR EACH ROW EXECUTE FUNCTION "osl_tenant_milestones"();

CREATE TRIGGER "osl_tenant" BEFORE INSERT OR UPDATE OF "channel_id" ON "channel_members" FOR EACH ROW EXECUTE FUNCTION "osl_tenant_channel_members"();

CREATE TRIGGER "osl_tenant" BEFORE INSERT OR UPDATE OF "channel_id" ON "messages" FOR EACH ROW EXECUTE FUNCTION "osl_tenant_messages"();

CREATE TRIGGER "osl_tenant" BEFORE INSERT OR UPDATE OF "channel_id" ON "channel_invites" FOR EACH ROW EXECUTE FUNCTION "osl_tenant_channel_invites"();

ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams_tenant" ON "teams" USING ("id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_members_tenant" ON "team_members" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_tenant" ON "projects" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_tenant" ON "tasks" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

CREATE POLICY "tasks_public_read" ON "tasks" FOR SELECT USING ("osl_read_tasks_project_id_public"("project_id") = true);

ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notes_tenant" ON "notes" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

ALTER TABLE "milestones" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milestones_tenant" ON "milestones" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channels_tenant" ON "channels" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

ALTER TABLE "channel_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_members_tenant" ON "channel_members" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_tenant" ON "messages" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

ALTER TABLE "team_invites" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_invites_tenant" ON "team_invites" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

ALTER TABLE "channel_invites" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_invites_tenant" ON "channel_invites" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));
