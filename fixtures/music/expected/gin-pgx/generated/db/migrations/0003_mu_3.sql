-- OSL migration 3: MU-3 (Playlists owned by a listener, PlaylistTrack ordered within its playlist, a playlist's tracks through it)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "playlists" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "owner_id" uuid NOT NULL,
  "name" varchar(120) NOT NULL,
  "public" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE "playlist_tracks" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "playlist_id" uuid NOT NULL,
  "track_id" uuid NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "added_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

ALTER TABLE "playlists" ADD CONSTRAINT "playlists_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE CASCADE;

CREATE INDEX "playlists_owner_id_idx" ON "playlists" ("owner_id");

ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "playlists" ("id") ON DELETE CASCADE;

ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE CASCADE;

CREATE INDEX "playlist_tracks_playlist_id_idx" ON "playlist_tracks" ("playlist_id");

CREATE INDEX "playlist_tracks_track_id_idx" ON "playlist_tracks" ("track_id");

ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlist_id_position_key" UNIQUE ("playlist_id", "position") DEFERRABLE INITIALLY IMMEDIATE;

CREATE FUNCTION "osl_hold_playlist_tracks"(osl_parent uuid) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  osl_try integer := 0;
BEGIN
  LOOP
    BEGIN
      -- The parent first, and waited for: one writer at a time per parent
      PERFORM 1 FROM "playlists" WHERE "id" = osl_parent FOR NO KEY UPDATE;
      -- Then every row of the parent, without waiting: a writer never waits for a row while it holds others
      PERFORM 1 FROM "playlist_tracks" WHERE "playlist_id" = osl_parent FOR UPDATE NOWAIT;
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

CREATE FUNCTION "osl_position_playlist_tracks"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- One writer at a time per parent: the lock every append, move and remove of its rows waits for first
  PERFORM 1 FROM "playlists" WHERE "id" = NEW."playlist_id" FOR NO KEY UPDATE;
  -- After the last row, wherever that is. An append takes no other row of the parent: its own checks come
  -- next (the rows it points at), and it must not hold what a delete of one of those rows is waiting for.
  SELECT coalesce(max("position"), 0) + 1 INTO NEW."position" FROM "playlist_tracks" WHERE "playlist_id" = NEW."playlist_id";
  RETURN NEW;
END
$$;

CREATE FUNCTION "osl_close_playlist_tracks"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  osl_parent record;
BEGIN
  FOR osl_parent IN SELECT DISTINCT "playlist_id" AS id FROM osl_gone ORDER BY 1 LOOP
    -- The deleted rows are already held, so nothing is waited for here: the parent and its rows are taken
    -- only if they are free. Otherwise the gap stays for the next writer of that parent, which closes it.
    BEGIN
      PERFORM 1 FROM "playlists" WHERE "id" = osl_parent.id FOR NO KEY UPDATE NOWAIT;
      PERFORM 1 FROM "playlist_tracks" WHERE "playlist_id" = osl_parent.id FOR UPDATE NOWAIT;
      UPDATE "playlist_tracks" AS r SET "position" = o.place
      FROM (SELECT "id" AS id, row_number() OVER (ORDER BY "position", "id") AS place FROM "playlist_tracks" WHERE "playlist_id" = osl_parent.id) AS o
      WHERE r."id" = o.id AND r."position" <> o.place;
    EXCEPTION WHEN lock_not_available THEN NULL;
    END;
  END LOOP;
  RETURN NULL;
END
$$;

CREATE FUNCTION "osl_move_playlist_tracks"(osl_row uuid, osl_to integer) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  osl_parent uuid;
  osl_count integer;
  osl_place integer;
BEGIN
  SELECT "playlist_id" INTO osl_parent FROM "playlist_tracks" WHERE "id" = osl_row;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM "osl_hold_playlist_tracks"(osl_parent);
  SELECT count(*) INTO osl_count FROM "playlist_tracks" WHERE "playlist_id" = osl_parent;
  PERFORM 1 FROM "playlist_tracks" WHERE "id" = osl_row AND "playlist_id" = osl_parent;
  IF NOT FOUND THEN RETURN NULL; END IF;
  osl_place := greatest(1, least(osl_to, osl_count));
  -- One statement: the others keep their order around the place the row takes, numbered 1..n
  UPDATE "playlist_tracks" AS r SET "position" = o.place
  FROM (
    SELECT s.id, CASE WHEN s.id = osl_row THEN osl_place WHEN s.rank >= osl_place THEN s.rank + 1 ELSE s.rank END AS place
    FROM (SELECT "id" AS id, row_number() OVER (ORDER BY ("id" = osl_row), "position", "id") AS rank FROM "playlist_tracks" WHERE "playlist_id" = osl_parent) AS s
  ) AS o
  WHERE r."id" = o.id AND r."position" <> o.place;
  RETURN osl_place;
END
$$;

CREATE FUNCTION "osl_remove_playlist_tracks"(osl_row uuid) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  osl_parent uuid;
BEGIN
  SELECT "playlist_id" INTO osl_parent FROM "playlist_tracks" WHERE "id" = osl_row;
  IF NOT FOUND THEN RETURN false; END IF;
  -- The parent and its rows first, then the delete: the trigger that follows finds them held and closes the gap
  PERFORM "osl_hold_playlist_tracks"(osl_parent);
  DELETE FROM "playlist_tracks" WHERE "id" = osl_row;
  RETURN FOUND;
END
$$;

CREATE TRIGGER "osl_order_assign" BEFORE INSERT ON "playlist_tracks" FOR EACH ROW EXECUTE FUNCTION "osl_position_playlist_tracks"();

CREATE TRIGGER "osl_order_close" AFTER DELETE ON "playlist_tracks" REFERENCING OLD TABLE AS osl_gone FOR EACH STATEMENT EXECUTE FUNCTION "osl_close_playlist_tracks"();
