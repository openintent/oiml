-- OSL migration 14: FEAT-14 (Article status is a review state machine (submit, approve, reject, retire) with stamps, a count of approved articles on User, timers that retire and then archive, an event on approve, a board by status)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "article_status" AS ENUM ('draft', 'in_review', 'approved', 'retired');

ALTER TABLE "users" ADD COLUMN "approved_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "articles" ADD COLUMN "status" "article_status" NOT NULL DEFAULT 'draft';

ALTER TABLE "articles" ADD COLUMN "approved_at" timestamp with time zone;

ALTER TABLE "articles" ADD COLUMN "retired_at" timestamp with time zone;

UPDATE "users" AS p SET "approved_count" = (SELECT count(*) FROM "articles" AS c WHERE c."author_id" = p."id" AND c."status" = 'approved');

CREATE FUNCTION "osl_count_users_approved_count"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  osl_delta record;
BEGIN
  -- What the statement did to each parent's count, parent by parent in key order: every statement asks for the
  -- rows it counts on in the same order, and each write waits for its row, so the number is exact
  IF TG_OP = 'INSERT' THEN
    FOR osl_delta IN SELECT "author_id" AS parent, count(*)::integer AS n FROM osl_new WHERE "author_id" IS NOT NULL AND "status" = 'approved' GROUP BY "author_id" ORDER BY "author_id" LOOP
      UPDATE "users" SET "approved_count" = "approved_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR osl_delta IN SELECT "author_id" AS parent, -count(*)::integer AS n FROM osl_old WHERE "author_id" IS NOT NULL AND "status" = 'approved' GROUP BY "author_id" ORDER BY "author_id" LOOP
      UPDATE "users" SET "approved_count" = "approved_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    -- A row that moved to another parent, or that the conditions hold for now and did not before (or the reverse)
    FOR osl_delta IN
      SELECT d.parent, sum(d.n)::integer AS n
      FROM (SELECT "author_id" AS parent, 1 AS n FROM osl_new WHERE "status" = 'approved' UNION ALL SELECT "author_id" AS parent, -1 AS n FROM osl_old WHERE "status" = 'approved') AS d
      WHERE d.parent IS NOT NULL GROUP BY d.parent HAVING sum(d.n) <> 0 ORDER BY d.parent
    LOOP
      UPDATE "users" SET "approved_count" = "approved_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSE
    -- TRUNCATE: no row is left to count
    UPDATE "users" SET "approved_count" = 0 WHERE "approved_count" <> 0;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER "osl_count_users_approved_count_ins" AFTER INSERT ON "articles" REFERENCING NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_approved_count"();

CREATE TRIGGER "osl_count_users_approved_count_del" AFTER DELETE ON "articles" REFERENCING OLD TABLE AS osl_old FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_approved_count"();

CREATE TRIGGER "osl_count_users_approved_count_upd" AFTER UPDATE ON "articles" REFERENCING OLD TABLE AS osl_old NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_approved_count"();

CREATE TRIGGER "osl_count_users_approved_count_trn" AFTER TRUNCATE ON "articles" FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_approved_count"();
