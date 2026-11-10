-- OSL migration 14: WS-15 (Milestone and Label archive, a project counts its milestones and the open ones, a user counts their teams)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "users" ADD COLUMN "team_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "projects" ADD COLUMN "milestone_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "projects" ADD COLUMN "open_milestones" integer NOT NULL DEFAULT 0;

ALTER TABLE "milestones" ADD COLUMN "archived_at" timestamp with time zone;

ALTER TABLE "labels" ADD COLUMN "archived_at" timestamp with time zone;

UPDATE "users" AS p SET "team_count" = (SELECT count(*) FROM "team_members" AS c WHERE c."user_id" = p."id");

UPDATE "projects" AS p SET "milestone_count" = (SELECT count(*) FROM "milestones" AS c WHERE c."project_id" = p."id");

UPDATE "projects" AS p SET "open_milestones" = (SELECT count(*) FROM "milestones" AS c WHERE c."project_id" = p."id" AND c."done" = false AND c."archived_at" IS NULL);

CREATE FUNCTION "osl_count_users_team_count"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  osl_delta record;
BEGIN
  -- What the statement did to each parent's count, parent by parent in key order: every statement asks for the
  -- rows it counts on in the same order, and each write waits for its row, so the number is exact
  IF TG_OP = 'INSERT' THEN
    FOR osl_delta IN SELECT "user_id" AS parent, count(*)::integer AS n FROM osl_new WHERE "user_id" IS NOT NULL GROUP BY "user_id" ORDER BY "user_id" LOOP
      UPDATE "users" SET "team_count" = "team_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR osl_delta IN SELECT "user_id" AS parent, -count(*)::integer AS n FROM osl_old WHERE "user_id" IS NOT NULL GROUP BY "user_id" ORDER BY "user_id" LOOP
      UPDATE "users" SET "team_count" = "team_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    -- A row that moved to another parent, or that the conditions hold for now and did not before (or the reverse)
    FOR osl_delta IN
      SELECT d.parent, sum(d.n)::integer AS n
      FROM (SELECT "user_id" AS parent, 1 AS n FROM osl_new UNION ALL SELECT "user_id" AS parent, -1 AS n FROM osl_old) AS d
      WHERE d.parent IS NOT NULL GROUP BY d.parent HAVING sum(d.n) <> 0 ORDER BY d.parent
    LOOP
      UPDATE "users" SET "team_count" = "team_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSE
    -- TRUNCATE: no row is left to count
    UPDATE "users" SET "team_count" = 0 WHERE "team_count" <> 0;
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION "osl_count_users_team_count"() FROM PUBLIC;

CREATE TRIGGER "osl_count_users_team_count_ins" AFTER INSERT ON "team_members" REFERENCING NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_team_count"();

CREATE TRIGGER "osl_count_users_team_count_del" AFTER DELETE ON "team_members" REFERENCING OLD TABLE AS osl_old FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_team_count"();

CREATE TRIGGER "osl_count_users_team_count_upd" AFTER UPDATE ON "team_members" REFERENCING OLD TABLE AS osl_old NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_team_count"();

CREATE TRIGGER "osl_count_users_team_count_trn" AFTER TRUNCATE ON "team_members" FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_team_count"();

CREATE FUNCTION "osl_count_projects_milestone_count"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  osl_delta record;
BEGIN
  -- What the statement did to each parent's count, parent by parent in key order: every statement asks for the
  -- rows it counts on in the same order, and each write waits for its row, so the number is exact
  IF TG_OP = 'INSERT' THEN
    FOR osl_delta IN SELECT "project_id" AS parent, count(*)::integer AS n FROM osl_new WHERE "project_id" IS NOT NULL GROUP BY "project_id" ORDER BY "project_id" LOOP
      UPDATE "projects" SET "milestone_count" = "milestone_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR osl_delta IN SELECT "project_id" AS parent, -count(*)::integer AS n FROM osl_old WHERE "project_id" IS NOT NULL GROUP BY "project_id" ORDER BY "project_id" LOOP
      UPDATE "projects" SET "milestone_count" = "milestone_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    -- A row that moved to another parent, or that the conditions hold for now and did not before (or the reverse)
    FOR osl_delta IN
      SELECT d.parent, sum(d.n)::integer AS n
      FROM (SELECT "project_id" AS parent, 1 AS n FROM osl_new UNION ALL SELECT "project_id" AS parent, -1 AS n FROM osl_old) AS d
      WHERE d.parent IS NOT NULL GROUP BY d.parent HAVING sum(d.n) <> 0 ORDER BY d.parent
    LOOP
      UPDATE "projects" SET "milestone_count" = "milestone_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSE
    -- TRUNCATE: no row is left to count
    UPDATE "projects" SET "milestone_count" = 0 WHERE "milestone_count" <> 0;
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION "osl_count_projects_milestone_count"() FROM PUBLIC;

CREATE TRIGGER "osl_count_projects_milestone_count_ins" AFTER INSERT ON "milestones" REFERENCING NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_projects_milestone_count"();

CREATE TRIGGER "osl_count_projects_milestone_count_del" AFTER DELETE ON "milestones" REFERENCING OLD TABLE AS osl_old FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_projects_milestone_count"();

CREATE TRIGGER "osl_count_projects_milestone_count_upd" AFTER UPDATE ON "milestones" REFERENCING OLD TABLE AS osl_old NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_projects_milestone_count"();

CREATE TRIGGER "osl_count_projects_milestone_count_trn" AFTER TRUNCATE ON "milestones" FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_projects_milestone_count"();

CREATE FUNCTION "osl_count_projects_open_milestones"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  osl_delta record;
BEGIN
  -- What the statement did to each parent's count, parent by parent in key order: every statement asks for the
  -- rows it counts on in the same order, and each write waits for its row, so the number is exact
  IF TG_OP = 'INSERT' THEN
    FOR osl_delta IN SELECT "project_id" AS parent, count(*)::integer AS n FROM osl_new WHERE "project_id" IS NOT NULL AND "done" = false AND "archived_at" IS NULL GROUP BY "project_id" ORDER BY "project_id" LOOP
      UPDATE "projects" SET "open_milestones" = "open_milestones" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR osl_delta IN SELECT "project_id" AS parent, -count(*)::integer AS n FROM osl_old WHERE "project_id" IS NOT NULL AND "done" = false AND "archived_at" IS NULL GROUP BY "project_id" ORDER BY "project_id" LOOP
      UPDATE "projects" SET "open_milestones" = "open_milestones" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    -- A row that moved to another parent, or that the conditions hold for now and did not before (or the reverse)
    FOR osl_delta IN
      SELECT d.parent, sum(d.n)::integer AS n
      FROM (SELECT "project_id" AS parent, 1 AS n FROM osl_new WHERE "done" = false AND "archived_at" IS NULL UNION ALL SELECT "project_id" AS parent, -1 AS n FROM osl_old WHERE "done" = false AND "archived_at" IS NULL) AS d
      WHERE d.parent IS NOT NULL GROUP BY d.parent HAVING sum(d.n) <> 0 ORDER BY d.parent
    LOOP
      UPDATE "projects" SET "open_milestones" = "open_milestones" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSE
    -- TRUNCATE: no row is left to count
    UPDATE "projects" SET "open_milestones" = 0 WHERE "open_milestones" <> 0;
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION "osl_count_projects_open_milestones"() FROM PUBLIC;

CREATE TRIGGER "osl_count_projects_open_milestones_ins" AFTER INSERT ON "milestones" REFERENCING NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_projects_open_milestones"();

CREATE TRIGGER "osl_count_projects_open_milestones_del" AFTER DELETE ON "milestones" REFERENCING OLD TABLE AS osl_old FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_projects_open_milestones"();

CREATE TRIGGER "osl_count_projects_open_milestones_upd" AFTER UPDATE ON "milestones" REFERENCING OLD TABLE AS osl_old NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_projects_open_milestones"();

CREATE TRIGGER "osl_count_projects_open_milestones_trn" AFTER TRUNCATE ON "milestones" FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_projects_open_milestones"();

CREATE FUNCTION "osl_count_hold_milestones"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- The parent and every row of it, as a move takes them: the count that follows writes the parent, and whoever
  -- holds the parent then holds its rows too, so no count waits for a parent whose rows are half taken
  PERFORM "osl_hold_milestones"(NEW."project_id");
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION "osl_count_hold_milestones"() FROM PUBLIC;

CREATE TRIGGER "osl_count_hold" BEFORE INSERT ON "milestones" FOR EACH ROW EXECUTE FUNCTION "osl_count_hold_milestones"();
