-- OSL migration 17: WS-18 (Invoice under a team: a number from a sequence counted per team (INV-000001), a total as money in the row's currency and a fee as money in USD, a count of invoices on Team, a table page; an invoice page at /invoices/:id)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TYPE "invoice_currency" AS ENUM ('USD', 'EUR', 'JPY');

CREATE TABLE "invoices" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "number" varchar(255) NOT NULL DEFAULT '',
  "customer" varchar(160) NOT NULL,
  "currency" "invoice_currency" NOT NULL DEFAULT 'USD',
  "total" numeric(19, 4) NOT NULL,
  "fee" numeric(19, 4),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "invoices_team_id_number_key" UNIQUE ("team_id", "number")
);

ALTER TABLE "teams" ADD COLUMN "invoice_count" integer NOT NULL DEFAULT 0;

UPDATE "teams" AS p SET "invoice_count" = (SELECT count(*) FROM "invoices" AS c WHERE c."team_id" = p."id");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON DELETE CASCADE;

CREATE INDEX "invoices_team_id_idx" ON "invoices" ("team_id");

GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO "workspace_app";

CREATE FUNCTION "osl_exists_invoices"(uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "invoices" WHERE "id" = $1)
$$;

REVOKE ALL ON FUNCTION "osl_exists_invoices"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "osl_exists_invoices"(uuid) TO "workspace_app";

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_tenant" ON "invoices" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));

CREATE FUNCTION "osl_count_teams_invoice_count"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  osl_delta record;
BEGIN
  -- What the statement did to each parent's count, parent by parent in key order: every statement asks for the
  -- rows it counts on in the same order, and each write waits for its row, so the number is exact
  IF TG_OP = 'INSERT' THEN
    FOR osl_delta IN SELECT "team_id" AS parent, count(*)::integer AS n FROM osl_new WHERE "team_id" IS NOT NULL GROUP BY "team_id" ORDER BY "team_id" LOOP
      UPDATE "teams" SET "invoice_count" = "invoice_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR osl_delta IN SELECT "team_id" AS parent, -count(*)::integer AS n FROM osl_old WHERE "team_id" IS NOT NULL GROUP BY "team_id" ORDER BY "team_id" LOOP
      UPDATE "teams" SET "invoice_count" = "invoice_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSIF TG_OP = 'UPDATE' THEN
    -- A row that moved to another parent, or that the conditions hold for now and did not before (or the reverse)
    FOR osl_delta IN
      SELECT d.parent, sum(d.n)::integer AS n
      FROM (SELECT "team_id" AS parent, 1 AS n FROM osl_new UNION ALL SELECT "team_id" AS parent, -1 AS n FROM osl_old) AS d
      WHERE d.parent IS NOT NULL GROUP BY d.parent HAVING sum(d.n) <> 0 ORDER BY d.parent
    LOOP
      UPDATE "teams" SET "invoice_count" = "invoice_count" + osl_delta.n WHERE "id" = osl_delta.parent;
    END LOOP;
  ELSE
    -- TRUNCATE: no row is left to count
    UPDATE "teams" SET "invoice_count" = 0 WHERE "invoice_count" <> 0;
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION "osl_count_teams_invoice_count"() FROM PUBLIC;

CREATE TRIGGER "osl_count_teams_invoice_count_ins" AFTER INSERT ON "invoices" REFERENCING NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_teams_invoice_count"();

CREATE TRIGGER "osl_count_teams_invoice_count_del" AFTER DELETE ON "invoices" REFERENCING OLD TABLE AS osl_old FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_teams_invoice_count"();

CREATE TRIGGER "osl_count_teams_invoice_count_upd" AFTER UPDATE ON "invoices" REFERENCING OLD TABLE AS osl_old NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_teams_invoice_count"();

CREATE TRIGGER "osl_count_teams_invoice_count_trn" AFTER TRUNCATE ON "invoices" FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_teams_invoice_count"();

CREATE TABLE "osl_sequences" (
  "sequence" text NOT NULL,
  "scope" text NOT NULL,
  "last" bigint NOT NULL,
  PRIMARY KEY ("sequence", "scope")
);

CREATE FUNCTION "osl_sequence_invoices_number"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  osl_count bigint;
BEGIN
  -- The counter of the row's scope, made on first use and held until this transaction ends: whoever creates
  -- next in the scope waits here and counts on from what this one leaves, or from before it if it rolls back
  INSERT INTO "osl_sequences" AS s ("sequence", "scope", "last")
  VALUES ('invoices.number', jsonb_build_array(NEW."team_id")::text, 1)
  ON CONFLICT ("sequence", "scope") DO UPDATE SET "last" = s."last" + 1
  RETURNING s."last" INTO osl_count;
  NEW."number" := 'INV-' || lpad(osl_count::text, greatest(6, length(osl_count::text)), '0');
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION "osl_sequence_invoices_number"() FROM PUBLIC;

CREATE TRIGGER "osl_sequence_number" BEFORE INSERT ON "invoices" FOR EACH ROW EXECUTE FUNCTION "osl_sequence_invoices_number"();
