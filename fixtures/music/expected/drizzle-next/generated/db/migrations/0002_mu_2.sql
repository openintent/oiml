-- OSL migration 2: MU-2 (Genres and a TrackGenre junction, with a track's genres and a genre's tracks as relations through it)
-- Generated from the model history. Do not edit after it has been applied.

CREATE TABLE "genres" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" varchar(60) NOT NULL UNIQUE,
  PRIMARY KEY ("id")
);

CREATE TABLE "track_genres" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "track_id" uuid NOT NULL,
  "genre_id" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "track_genres_track_id_genre_id_key" UNIQUE ("track_id", "genre_id")
);

ALTER TABLE "track_genres" ADD CONSTRAINT "track_genres_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE CASCADE;

ALTER TABLE "track_genres" ADD CONSTRAINT "track_genres_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres" ("id") ON DELETE CASCADE;

CREATE INDEX "track_genres_track_id_idx" ON "track_genres" ("track_id");

CREATE INDEX "track_genres_genre_id_idx" ON "track_genres" ("genre_id");
