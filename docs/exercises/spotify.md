# Exercise: a Spotify clone

**Status: assessed 2026-11-09.** Not a construct: the first clone exercise. An application people know is
decomposed into the intents that would build it, each intent gets a verdict against the model reference and the
design notes, and what no intent can say goes to the backlog. Nothing here is built; the sketches are starting
points for design notes, not grammar.

The method, for the next exercise: write the intents in the fixtures' shape (an ask and its acceptance), judge each
against `docs/model.md` at the current commit plus `docs/designs/*.md`, mark it expressible, partial or out, rank
what blocks the most intents, and record the result here and in `evals/propose/gaps.yaml` with
`first_seen: exercise-<app>` and `cases: 0`. A round that later asks for the same thing raises the count; a
construct still needs a fixture and scenarios before the backlog says built.

## The intent series

Verdicts: **yes** means the intent lands as a diff today; **partial** means the data lands and a named piece does
not; **out** means the model does not express it, with the reason.

| Intent                                          | Ask, in one sentence                                                                                                                                                                                       | Verdict                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SP-1 Accounts                                   | People sign up with a password, Google or Apple, and have a display name, an avatar, a country and a plan (free or premium) they cannot set themselves.                                                    | yes: `read_only` plan and role, the avatar as a file field, three providers                                                                                                                                                                                                                                                                    |
| SP-2 Artists and their teams                    | An artist is a page with a name, a bio and an image; the people who manage an artist (owner, manager) are its team, and only they touch its catalog.                                                       | yes: Artist as the tenancy entity, `member:artist_id` on catalog rows; it takes the one tenancy slot                                                                                                                                                                                                                                           |
| SP-3 Catalog                                    | Albums hold tracks in order; a track has an audio file, a duration, an explicit flag, lyrics, featured artists and genres; unreleased work is invisible outside the team and looks as if it did not exist. | yes since round B2 (2026-11-10): the entities, rules through `album_id.status` and `hidden: not_found` land; the tracks of an album are a `position` within `album_id`, and featured artists and genres are relations through their junctions, so a track shows their names (music MU-1 and MU-2 prove the two)                                |
| SP-4 Releases                                   | A team schedules an album for a date and it goes live then; an admin can take a release down.                                                                                                              | yes: since round B4 (2026-11-10) the release is `transitions` on the album's status (schedule, release, take_down under the admin's rule), and the timer on `release_at` runs `albums.release`, which leaves an album that is no longer scheduled alone; no handler                                                                            |
| SP-5 Playlists                                  | A listener makes playlists with a name, a cover and a public flag, adds tracks in an order they can change, and may let chosen people edit a playlist with them.                                           | yes since round B2 (2026-11-10): the entry is a junction with a `position` within its playlist, create appends, `playlist_tracks.move` reorders, a delete closes the gap and the page drags (music MU-3); the playlist's tracks are a relation through it, in that order; collaborators are `member:collaborators` since round A2 (2026-11-09) |
| SP-6 Library                                    | A listener likes tracks, saves albums, follows artists, people and playlists, each at most once, and sees their own library.                                                                               | yes: five junction entities with unique pairs, owner rules and cascade (the pattern the likes and followers eval cases prove); a Liked Songs page filtered by `{actor.id}` with `include: [track]` shows titles                                                                                                                                |
| SP-7 Playback history                           | Every play is recorded for the listener; a track shows how often it was played; a listener resumes an episode where they left it.                                                                          | yes: a Play entity under owner rules, `tracks.record_play` as a public row action, progress as an upsert action; since round B3 (2026-11-10) the number is `play_count: { count_of: plays }` on Track and no handler moves it                                                                                                                                              |
| SP-8 Streaming                                  | Audio plays only for signed-in listeners (premium for the high-quality file) with seeking, while cover art is public.                                                                                      | out: `files.read` is one rule for every file; local storage streams a whole file without Range (the S3 redirect answers Range itself); premium needs a condition on the actor                                                                                                                                                                  |
| SP-9 Search                                     | One box finds tracks, artists, albums and playlists by name.                                                                                                                                               | partial: `search:` per resource; one box across four is a custom page                                                                                                                                                                                                                                                                          |
| SP-10 Home and discovery                        | Home shows new releases, an artist's top tracks, a chart of the week and a made-for-you mix.                                                                                                               | partial: new releases and top tracks are ordered lists; the chart is an aggregate over a window; the mix is an action returning a custom shape whose handler is the logic                                                                                                                                                                      |
| SP-11 Artist, album, playlist and profile pages | Each artist, album, playlist and listener has a page at its own address, composed of a header and lists from other resources, shareable as a link when public.                                             | out: pages with parameters is an open gap; a page composed of sections has no construct; the table layout's detail page shows one row and its reverse rows as a name list                                                                                                                                                                      |
| SP-12 Player and queue                          | A now-playing bar stays across every page with a queue, shuffle and repeat.                                                                                                                                | out by design: the app shell is a scaffold the user edits in `src/`                                                                                                                                                                                                                                                                            |
| SP-13 Social and live                           | Friends' activity appears as it happens; collaborators see each other's edits live; playback hands over between devices.                                                                                   | out: realtime is declined; `refresh` polls the feed                                                                                                                                                                                                                                                                                            |
| SP-14 Premium                                   | A listener upgrades through a card payment and the plan changes when the provider confirms it.                                                                                                             | out: payments are declined; an incoming webhook in `src/` sets the `read_only` plan                                                                                                                                                                                                                                                            |
| SP-15 Admin and moderation                      | Admins ban listeners, take down tracks and work a queue of reports; every moderation act is on record.                                                                                                     | yes: the banning pattern of blog FEAT-7, a Report entity, actions; audit is designed                                                                                                                                                                                                                                                           |
| SP-16 Podcasts                                  | Shows hold episodes; listeners subscribe and resume where they stopped.                                                                                                                                    | yes, with the verdicts of SP-3 and SP-7                                                                                                                                                                                                                                                                                                        |

Twelve intents land, one is partial, three are out by design or by an open gap (ten, three and three before round B2 built gaps 2 and 3). Spotify's data model and rules
are OSL's shape; its screens are not, because each screen is a parameterized composition, and two of its core
behaviours (ordered collaborative playlists, protected streaming) need constructs the rounds have each asked for
once.

## The gaps, ranked by how much of the app they block

1. **Pages with parameters and sections** (backlog `pages with parameters`, open since r5). Blocks SP-11, which
   is every screen but Home, Search and Library. Sketch: a page kind over one row of a resource at
   `path: /artists/:id`, with `sections: [{ resource: albums, filter: { artist_id: "{param.id}" }, order:
[[release_at, desc]], limit: 10 }]`, each section a list filtered by a relation field equal to the parameter,
   and `access` as today. The dashboard generator already composes tiles and recent lists, so both web backends
   have the shape; the API gains nothing, since each section is a list the resource already serves.
2. **Many-to-many relations** (backlog `relations beyond many-to-one`, open since r6). Blocks the second half of
   SP-3 and the display in SP-5. Sketch: an entity-level relation through a junction,
   `relations: { artists: { through: TrackArtist, to: Artist } }`, so `include: [artists]` returns Artist rows,
   pages render their display names, and create and update accept `artist_ids` (the junction rows written in the
   transaction). One join shape on the three backends. Built in round B2 (2026-11-10) as
   `relations: { artists: { through: TrackArtist } }` on the entity, with the junction a declared entity that keeps
   its rules and its resource: a link is written through that resource, so create and update take no `artist_ids`
   (`../designs/many-to-many-and-ordering.md`).
3. **Ordered collections** (backlog `ordering and positions`, open since r5). Blocks the rest of SP-5 and the
   album track order. Sketch: `position: { within: playlist_id }` on a child or junction entity; create appends
   inside the transaction, a compiler-written `move { to }` row action renumbers, delete closes the gap, the
   reverse relation renders in order, and the web page drags to reorder. Proven together with 2 by one playlist
   fixture. Built in round B2 (2026-11-10) as `position: { within: playlist_id }` on an integer field, with the
   order kept by the database and `move { to }` under the update rule (`../designs/many-to-many-and-ordering.md`,
   fixture `music`).
4. **Membership through any relation** (new, `membership through any relation`). Blocks collaborative playlists,
   and any "shared with" ask once the tenancy slot is taken. Sketch: a predicate over a reverse relation to a
   junction that carries an identity relation, `update: "owner:owner_id or in:collaborators"`, compiled to the
   EXISTS subquery `member:` uses today, with the junction's role enum ranked the same way when it has one.
   Design: `../designs/membership-through-any-relation.md`, which spells it `member:collaborators`. Built in round A2 (2026-11-09).
5. **File access per field** (backlog `files and media`, open since r4). Blocks SP-8. Sketch:
   `file: { accept, max_size, read: <rule> }` with the row's read rule as the default, so whoever may read the
   track may stream it and cover art says `public`; the local storage path answers Range requests. The S3 path
   already does.
6. **Counts** (backlog `computed and aggregate fields`; built in round B3, `designs/archive-and-counts.md`).
   Followers, likes, tracks in a playlist and plays are each `count_of`. The tracks of a playlist are the case the
   round had to design for: rows ordered within the row that counts them, where an append takes the playlist the
   way a move does. Charts over a window stay out: a schedule writing a `read_only` rank is today's answer.
7. **Actor conditions** (new, `actor conditions`). Blocks premium-only quality, the explicit-content setting and
   country availability. Sketch: `when actor.<field> = <value>` on any predicate; the session row is loaded for
   every check, so the mapping is one comparison on every backend, and lists need no subquery.
8. **Search across resources** (new, `search across resources`). Blocks the one-box part of SP-9. Likely declined
   with a sentence: a custom page composes the per-resource searches. Recorded so that a round asking twice
   decides it.

## Out by design, and still right

- Realtime: friend activity, live collaborative edits, device handoff. `refresh` polls.
- Payments: the provider's webhook lands in `src/` and sets a `read_only` plan.
- Recommendations: an action with a custom return shape; the logic is a handler.
- The persistent player: the shell scaffold is the hook; the model declares pages, not chrome.

## Bake order

Build 2 and 3 together on a fourth fixture, a music catalog, because playlist tracks prove both at once; then 1,
which the artist page needs 2 for; then 4, 5 and 7 as one media-and-sharing round; counts are built (round B3).
When a construct is designed, its backlog key becomes a topic in `packages/evals/src/gaps.ts` so the rounds file
their lines under it (collaborator, shared with, co-editor; the actor's plan, premium only, the viewer's setting;
one search box, search everything).

## The fixture it implies

`fixtures/music`: MU-1 accounts and artists (SP-1, SP-2), MU-2 catalog and releases (SP-3, SP-4), MU-3 playlists
(SP-5, the proof of 2 and 3), MU-4 library and plays (SP-6, SP-7), MU-5 pages (SP-11, the proof of 1), MU-6
streaming and sharing (SP-8, the rest of SP-5, the proof of 4, 5 and 7). Each later clone exercise adds intents
here or starts a sibling fixture.
