-- OSL migration 10: WS-12 (A position on Milestone within its project, team labels, and a milestone's labels through a junction that names its team)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "labels" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "name" varchar(60) NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "labels_team_id_name_key" UNIQUE ("team_id", "name"),
  CONSTRAINT "labels_team_id_id_key" UNIQUE ("team_id", "id")
);

CREATE TABLE "milestone_labels" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "milestone_id" uuid NOT NULL,
  "label_id" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "milestone_labels_milestone_id_label_id_key" UNIQUE ("milestone_id", "label_id")
);

ALTER TABLE "milestones" ADD COLUMN "position" integer NOT NULL DEFAULT 0;

UPDATE "milestones" AS r SET "position" = o.place FROM (SELECT "id" AS id, row_number() OVER (PARTITION BY "project_id" ORDER BY "id") AS place FROM "milestones") AS o WHERE r."id" = o.id;

ALTER TABLE "milestones" ADD CONSTRAINT "milestones_team_id_id_key" UNIQUE ("team_id", "id");

ALTER TABLE "labels" ADD CONSTRAINT "labels_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE CASCADE;

CREATE INDEX "labels_team_id_idx" ON "labels" ("team_id");

ALTER TABLE "milestone_labels" ADD CONSTRAINT "milestone_labels_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE CASCADE;

ALTER TABLE "milestone_labels" ADD CONSTRAINT "milestone_labels_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones" ("id") ON DELETE CASCADE;

ALTER TABLE "milestone_labels" ADD CONSTRAINT "milestone_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels" ("id") ON DELETE CASCADE;

CREATE INDEX "milestone_labels_team_id_idx" ON "milestone_labels" ("team_id");

CREATE INDEX "milestone_labels_milestone_id_idx" ON "milestone_labels" ("milestone_id");

CREATE INDEX "milestone_labels_label_id_idx" ON "milestone_labels" ("label_id");

ALTER TABLE "milestone_labels" ADD CONSTRAINT "milestone_labels_team_id_milestone_id_fkey" FOREIGN KEY ("team_id", "milestone_id") REFERENCES "milestones" ("team_id", "id") ON DELETE CASCADE;

ALTER TABLE "milestone_labels" ADD CONSTRAINT "milestone_labels_team_id_label_id_fkey" FOREIGN KEY ("team_id", "label_id") REFERENCES "labels" ("team_id", "id") ON DELETE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "labels" TO "workspace_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "milestone_labels" TO "workspace_app";

ALTER TABLE "labels" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "labels_tenant" ON "labels" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

ALTER TABLE "milestone_labels" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milestone_labels_tenant" ON "milestone_labels" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_position_key" UNIQUE ("project_id", "position") DEFERRABLE INITIALLY IMMEDIATE;

CREATE FUNCTION "osl_hold_milestones"(osl_parent uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  osl_try integer := 0;
BEGIN
  LOOP
    BEGIN
      -- The parent first, and waited for: one writer at a time per parent
      PERFORM 1 FROM "projects" WHERE "id" = osl_parent FOR NO KEY UPDATE;
      -- Then every row of the parent, without waiting: a writer never waits for a row while it holds others
      PERFORM 1 FROM "milestones" WHERE "project_id" = osl_parent FOR UPDATE NOWAIT;
      RETURN;
    EXCEPTION WHEN lock_not_available THEN
      -- Someone holds a row (an update in flight, a cascade): everything taken here is given back, and the
      -- writer tries again shortly. Whoever held the row cannot have been waiting for this writer.
      osl_try := osl_try + 1;
      IF osl_try >= 200 THEN RAISE; END IF;
    END;
    PERFORM pg_sleep(0.005 * least(osl_try, 10));
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION "osl_hold_milestones"(osl_parent uuid) FROM PUBLIC;

CREATE FUNCTION "osl_position_milestones"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- One writer at a time per parent: the lock every append, move and remove of its rows waits for first
  PERFORM 1 FROM "projects" WHERE "id" = NEW."project_id" FOR NO KEY UPDATE;
  -- After the last row, wherever that is. An append takes no other row of the parent: its own checks come
  -- next (the rows it points at), and it must not hold what a delete of one of those rows is waiting for.
  SELECT coalesce(max("position"), 0) + 1 INTO NEW."position" FROM "milestones" WHERE "project_id" = NEW."project_id";
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION "osl_position_milestones"() FROM PUBLIC;

CREATE FUNCTION "osl_close_milestones"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  osl_parent record;
BEGIN
  FOR osl_parent IN SELECT DISTINCT "project_id" AS id FROM osl_gone ORDER BY 1 LOOP
    -- The deleted rows are already held, so nothing is waited for here: the parent and its rows are taken
    -- only if they are free. Otherwise the gap stays for the next writer of that parent, which closes it.
    BEGIN
      PERFORM 1 FROM "projects" WHERE "id" = osl_parent.id FOR NO KEY UPDATE NOWAIT;
      PERFORM 1 FROM "milestones" WHERE "project_id" = osl_parent.id FOR UPDATE NOWAIT;
      UPDATE "milestones" AS r SET "position" = o.place
      FROM (SELECT "id" AS id, row_number() OVER (ORDER BY "position", "id") AS place FROM "milestones" WHERE "project_id" = osl_parent.id) AS o
      WHERE r."id" = o.id AND r."position" <> o.place;
    EXCEPTION WHEN lock_not_available THEN NULL;
    END;
  END LOOP;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION "osl_close_milestones"() FROM PUBLIC;

CREATE FUNCTION "osl_move_milestones"(osl_row uuid, osl_to integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  osl_parent uuid;
  osl_count integer;
  osl_place integer;
BEGIN
  SELECT "project_id" INTO osl_parent FROM "milestones" WHERE "id" = osl_row AND "team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]);
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM "osl_hold_milestones"(osl_parent);
  SELECT count(*) INTO osl_count FROM "milestones" WHERE "project_id" = osl_parent;
  PERFORM 1 FROM "milestones" WHERE "id" = osl_row AND "project_id" = osl_parent;
  IF NOT FOUND THEN RETURN NULL; END IF;
  osl_place := greatest(1, least(osl_to, osl_count));
  -- One statement: the others keep their order around the place the row takes, numbered 1..n
  UPDATE "milestones" AS r SET "position" = o.place
  FROM (
    SELECT s.id, CASE WHEN s.id = osl_row THEN osl_place WHEN s.rank >= osl_place THEN s.rank + 1 ELSE s.rank END AS place
    FROM (SELECT "id" AS id, row_number() OVER (ORDER BY ("id" = osl_row), "position", "id") AS rank FROM "milestones" WHERE "project_id" = osl_parent) AS s
  ) AS o
  WHERE r."id" = o.id AND r."position" <> o.place;
  RETURN osl_place;
END
$$;

REVOKE ALL ON FUNCTION "osl_move_milestones"(osl_row uuid, osl_to integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_move_milestones"(osl_row uuid, osl_to integer) TO "workspace_app";

CREATE FUNCTION "osl_remove_milestones"(osl_row uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  osl_parent uuid;
BEGIN
  SELECT "project_id" INTO osl_parent FROM "milestones" WHERE "id" = osl_row AND "team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]);
  IF NOT FOUND THEN RETURN false; END IF;
  -- The parent and its rows first, then the delete: the trigger that follows finds them held and closes the gap
  PERFORM "osl_hold_milestones"(osl_parent);
  DELETE FROM "milestones" WHERE "id" = osl_row;
  RETURN FOUND;
END
$$;

REVOKE ALL ON FUNCTION "osl_remove_milestones"(osl_row uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_remove_milestones"(osl_row uuid) TO "workspace_app";

CREATE TRIGGER "osl_order_assign" BEFORE INSERT ON "milestones" FOR EACH ROW EXECUTE FUNCTION "osl_position_milestones"();

CREATE TRIGGER "osl_order_close" AFTER DELETE ON "milestones" REFERENCING OLD TABLE AS osl_gone FOR EACH STATEMENT EXECUTE FUNCTION "osl_close_milestones"();
