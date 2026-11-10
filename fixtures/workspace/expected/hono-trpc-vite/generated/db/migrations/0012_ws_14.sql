-- OSL migration 12: WS-14 (Request under a team with a status state machine (approve, decline, reopen, and an expire only a timer runs), a count of pending requests on Team, a board by status)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "request_status" AS ENUM ('pending', 'approved', 'declined', 'expired');

CREATE TABLE "requests" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "requester_id" uuid NOT NULL,
  "title" varchar(160) NOT NULL,
  "amount" integer NOT NULL,
  "status" "request_status" NOT NULL DEFAULT 'pending',
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "teams" ADD COLUMN "pending_requests" integer NOT NULL DEFAULT 0;

UPDATE "teams" AS p SET "pending_requests" = (SELECT count(*) FROM "requests" AS c WHERE c."team_id" = p."id" AND c."status" = 'pending');

ALTER TABLE "requests" ADD CONSTRAINT "requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE CASCADE;

ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "requests_team_id_idx" ON "requests" ("team_id");

CREATE INDEX "requests_requester_id_idx" ON "requests" ("requester_id");

GRANT SELECT, INSERT, UPDATE, DELETE ON "requests" TO "workspace_app";

CREATE FUNCTION "osl_exists_requests"(uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "requests" WHERE "id" = $1)
$$;

REVOKE ALL ON FUNCTION "osl_exists_requests"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_exists_requests"(uuid) TO "workspace_app";

ALTER TABLE "requests" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "requests_tenant" ON "requests" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

CREATE FUNCTION "osl_count_teams_pending_requests"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  osl_delta record;
BEGIN
  -- What the statement did to each parent's count, parent by parent in key order: every statement asks for the
  -- rows it counts on in the same order, and each write waits for its row, so the number is exact
  IF TG_OP = 'INSERT' THEN
    FOR osl_delta IN SELECT "team_id" AS parent, count(*)::integer AS n FROM osl_new WHERE "team_id" IS NOT NULL AND "status" = 'pending' GROUP BY "team_id" ORDER BY "team_id" LOOP
      UPDATE "teams" SET "pending_requests" = "pending_requests" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR osl_delta IN SELECT "team_id" AS parent, -count(*)::integer AS n FROM osl_old WHERE "team_id" IS NOT NULL AND "status" = 'pending' GROUP BY "team_id" ORDER BY "team_id" LOOP
      UPDATE "teams" SET "pending_requests" = "pending_requests" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    -- A row that moved to another parent, or that the conditions hold for now and did not before (or the reverse)
    FOR osl_delta IN
      SELECT d.parent, sum(d.n)::integer AS n
      FROM (SELECT "team_id" AS parent, 1 AS n FROM osl_new WHERE "status" = 'pending' UNION ALL SELECT "team_id" AS parent, -1 AS n FROM osl_old WHERE "status" = 'pending') AS d
      WHERE d.parent IS NOT NULL GROUP BY d.parent HAVING sum(d.n) <> 0 ORDER BY d.parent
    LOOP
      UPDATE "teams" SET "pending_requests" = "pending_requests" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSE
    -- TRUNCATE: no row is left to count
    UPDATE "teams" SET "pending_requests" = 0 WHERE "pending_requests" <> 0;
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION "osl_count_teams_pending_requests"() FROM PUBLIC;

CREATE TRIGGER "osl_count_teams_pending_requests_ins" AFTER INSERT ON "requests" REFERENCING NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_teams_pending_requests"();

CREATE TRIGGER "osl_count_teams_pending_requests_del" AFTER DELETE ON "requests" REFERENCING OLD TABLE AS osl_old FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_teams_pending_requests"();

CREATE TRIGGER "osl_count_teams_pending_requests_upd" AFTER UPDATE ON "requests" REFERENCING OLD TABLE AS osl_old NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_teams_pending_requests"();

CREATE TRIGGER "osl_count_teams_pending_requests_trn" AFTER TRUNCATE ON "requests" FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_teams_pending_requests"();
