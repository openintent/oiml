-- OSL migration 15: FEAT-15 (comment_count on Article kept by the database, Article archive under the author's rule with a queued event, a count of live published articles on User, a tile of archived articles)
-- Generated from the model history. Do not edit after it has been applied.

ALTER TABLE "users" ADD COLUMN "post_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "articles" ADD COLUMN "comment_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "articles" ADD COLUMN "archived_at" timestamp with time zone;

UPDATE "users" AS p SET "post_count" = (SELECT count(*) FROM "articles" AS c WHERE c."author_id" = p."id" AND c."published" = true AND c."archived_at" IS NULL);

UPDATE "articles" AS p SET "comment_count" = (SELECT count(*) FROM "comments" AS c WHERE c."article_id" = p."id");

CREATE FUNCTION "osl_count_users_post_count"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  osl_delta record;
BEGIN
  -- What the statement did to each parent's count, parent by parent in key order: every statement asks for the
  -- rows it counts on in the same order, and each write waits for its row, so the number is exact
  IF TG_OP = 'INSERT' THEN
    FOR osl_delta IN SELECT "author_id" AS parent, count(*)::integer AS n FROM osl_new WHERE "author_id" IS NOT NULL AND "published" = true AND "archived_at" IS NULL GROUP BY "author_id" ORDER BY "author_id" LOOP
      UPDATE "users" SET "post_count" = "post_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR osl_delta IN SELECT "author_id" AS parent, -count(*)::integer AS n FROM osl_old WHERE "author_id" IS NOT NULL AND "published" = true AND "archived_at" IS NULL GROUP BY "author_id" ORDER BY "author_id" LOOP
      UPDATE "users" SET "post_count" = "post_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    -- A row that moved to another parent, or that the conditions hold for now and did not before (or the reverse)
    FOR osl_delta IN
      SELECT d.parent, sum(d.n)::integer AS n
      FROM (SELECT "author_id" AS parent, 1 AS n FROM osl_new WHERE "published" = true AND "archived_at" IS NULL UNION ALL SELECT "author_id" AS parent, -1 AS n FROM osl_old WHERE "published" = true AND "archived_at" IS NULL) AS d
      WHERE d.parent IS NOT NULL GROUP BY d.parent HAVING sum(d.n) <> 0 ORDER BY d.parent
    LOOP
      UPDATE "users" SET "post_count" = "post_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSE
    -- TRUNCATE: no row is left to count
    UPDATE "users" SET "post_count" = 0 WHERE "post_count" <> 0;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER "osl_count_users_post_count_ins" AFTER INSERT ON "articles" REFERENCING NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_post_count"();

CREATE TRIGGER "osl_count_users_post_count_del" AFTER DELETE ON "articles" REFERENCING OLD TABLE AS osl_old FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_post_count"();

CREATE TRIGGER "osl_count_users_post_count_upd" AFTER UPDATE ON "articles" REFERENCING OLD TABLE AS osl_old NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_post_count"();

CREATE TRIGGER "osl_count_users_post_count_trn" AFTER TRUNCATE ON "articles" FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_users_post_count"();

CREATE FUNCTION "osl_count_articles_comment_count"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  osl_delta record;
BEGIN
  -- What the statement did to each parent's count, parent by parent in key order: every statement asks for the
  -- rows it counts on in the same order, and each write waits for its row, so the number is exact
  IF TG_OP = 'INSERT' THEN
    FOR osl_delta IN SELECT "article_id" AS parent, count(*)::integer AS n FROM osl_new WHERE "article_id" IS NOT NULL GROUP BY "article_id" ORDER BY "article_id" LOOP
      UPDATE "articles" SET "comment_count" = "comment_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR osl_delta IN SELECT "article_id" AS parent, -count(*)::integer AS n FROM osl_old WHERE "article_id" IS NOT NULL GROUP BY "article_id" ORDER BY "article_id" LOOP
      UPDATE "articles" SET "comment_count" = "comment_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    -- A row that moved to another parent, or that the conditions hold for now and did not before (or the reverse)
    FOR osl_delta IN
      SELECT d.parent, sum(d.n)::integer AS n
      FROM (SELECT "article_id" AS parent, 1 AS n FROM osl_new UNION ALL SELECT "article_id" AS parent, -1 AS n FROM osl_old) AS d
      WHERE d.parent IS NOT NULL GROUP BY d.parent HAVING sum(d.n) <> 0 ORDER BY d.parent
    LOOP
      UPDATE "articles" SET "comment_count" = "comment_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSE
    -- TRUNCATE: no row is left to count
    UPDATE "articles" SET "comment_count" = 0 WHERE "comment_count" <> 0;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER "osl_count_articles_comment_count_ins" AFTER INSERT ON "comments" REFERENCING NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_articles_comment_count"();

CREATE TRIGGER "osl_count_articles_comment_count_del" AFTER DELETE ON "comments" REFERENCING OLD TABLE AS osl_old FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_articles_comment_count"();

CREATE TRIGGER "osl_count_articles_comment_count_upd" AFTER UPDATE ON "comments" REFERENCING OLD TABLE AS osl_old NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_articles_comment_count"();

CREATE TRIGGER "osl_count_articles_comment_count_trn" AFTER TRUNCATE ON "comments" FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_articles_comment_count"();
