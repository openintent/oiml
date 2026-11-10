# Changelog

Versions are alpha releases of 1.0.0 until the road in `docs/roadmap.md` ends. Each construct is proven by a
fixture intent on all three backends before it is listed here.

## Unreleased

- Archive and counts (round B3 of the road to 1.0.0). `archive: true` on an entity (or `{ field, rule }`) gives it
  a server-owned `archived_at`: lists leave archived rows out unless asked with `?archived=true`, every resource
  over the entity gets the row actions `archive` and `restore` without declaring them (under the update rule or the
  archive's own, 409 when there is nothing to do), events follow them, a tile or a page filters with
  `archived: true`, and the pages get a "Show archived" switch with Archive and Restore in the detail pane. Get,
  update, delete and includes treat an archived row like any other, and a row with a position keeps its place.
  `count_of: <reverse relation>` on an integer field, with an optional `where`, is a number the database keeps:
  one function and four statement triggers on the counted table write each parent once in key order, the migration
  that adds the field counts the rows that exist, and the field is read-only, sortable and filterable. Where the
  counted rows are ordered within the row that counts them, an append takes the parent the way a move does, so
  round B2's concurrency test passes unchanged with a count in place; under `isolation: database` the count's
  functions run with their owner's rights, since a count is written whoever the caller is bound to. A delete of a
  counting row that races a write of one of its counted rows can end in PostgreSQL's deadlock detection: one
  request fails and the count stays exact. The rule walk predicts the archive's list filter and its 409s, and the
  rule and order walks compare every count with the rows it counts. New ops and keys: `set_archive`,
  `Entity.archive`, `Field.count_of`, `Field.where`; diagnostics M150 to M157. A timer cannot run `archive` itself
  (M133 says what to run); sums and other aggregates stay a handler's. Fixtures: workspace WS-13 (archived
  milestones and labels, a project's counts, a user's teams, under `isolation: database`) and blog FEAT-13 (comment
  counts, archived articles with a queued event, an author's count of live published articles). Design:
  `docs/designs/archive-and-counts.md`.
- PostgreSQL 18: the `docker-compose.yml` a new project gets starts `postgres:18`, with its volume at
  `/var/lib/postgresql`, where the 18 image keeps its data (it refuses to start with one at
  `/var/lib/postgresql/data`). CI and the nightly round run on 18 as well. The compose file is written once, so an
  existing project keeps the one it has.
- Many-to-many relations and ordered collections (round B2 of the road to 1.0.0), proven together by a fourth
  fixture, `music`. A junction stays a declared entity with its own rules and resource, and
  `relations: { genres: { through: TrackGenre } }` on an entity names the rows on its far side once: `include` on
  list and get returns them (a track shows its genres' names where it showed ids), a page column shows the names,
  and the detail pane adds and removes them through the junction's resource. `position: { within: album_id }` on
  an integer field makes an ordered collection: the server owns the place, create appends, the resource gets a
  `move` row action (`{ to }`, under the update rule) without declaring one, a delete closes the gap, lists and
  includes follow the order, and the pages drag to reorder. The order lives in the database (a deferrable unique
  constraint, an append trigger, `osl_move_<table>` and `osl_remove_<table>` under the parent row's lock), so
  hand-written code and cascades keep it; no writer waits for a row while holding rows of the parent, which a test
  proves with 24 connections against a real database. A sixth conformance walk, `order`, bursts concurrent creates,
  moves and deletes into one parent on every backend. New ops and keys: `set_relations`, `Field.position`,
  `Entity.relations`; diagnostics M014, M015 and M140 to M144. Adding a position to an entity that exists takes its
  parent field out of update (a row keeps its parent), which the contract walk reports as a breaking change the op
  explains. Fixtures: music MU-1 to MU-4 and workspace WS-12 (ordered milestones and labels under
  `isolation: database`). Design: `docs/designs/many-to-many-and-ordering.md`.
- The tenant isolation backstop (round B1 of the road to 1.0.0): `auth.tenancy.isolation: database` puts row-level
  security behind the rules on every tenant table (the tenant entity, the membership, and every entity that reaches
  the tenant through required relations). The compiler derives the tenant column of a table that does not declare
  it, kept by a trigger and a composite key so no row points at another tenant's parent; the migrations create an
  app role the policies bind, without a login or a password (`osl migrate` gives it the one in `DATABASE_APP_URL`),
  and the web process refuses to serve as any role they do not bind. A request reaches the rows of its caller's
  tenants and what a public read rule opens to everyone, which is compiled into a second, SELECT-only policy; a
  public alternative on create, update, delete or a row action of a tenant table is an error. Every alternative
  that needs a session also needs a membership of the row's tenant (`owner:assignee_id` on a task compiles as
  `owner:assignee_id and member:project_id.team_id`), so an owner who left the tenant no longer reaches the row;
  statuses are unchanged, another tenant's row still answers 403 or 401 through an existence probe. Row security is
  enabled, not forced, so the owner role (migrations, the worker) need not be a superuser. `osl drift` compares row
  security, policies, the functions that see past them and the triggers. The tenant walk runs a second pass with
  the generated rule checks switched off by a test hook, and an unbound probe of the app role. Diagnostics M115 to
  M119; workspace WS-11; eval cases `fx-ws-11-isolation`, `ws2-database-isolation`, `empty-clinic-isolation`.
  Models without the key generate byte-identical output.
- Membership through any relation (round A2 of the road to 1.0.0): a `member:` path may end in a membership
  relation, a reverse relation to a junction whose entity has a relation to the identity (`member:members` on a
  channel, `member:channel_id.members` on a message, `member:author_id.followers` on a bulletin); `:role` ranks an
  enum field marked `ranked: true` on the junction. Tenancy's `member:team_id` is unchanged. Lists filter with a
  subquery through the junction, row checks look the caller's membership row up, and the harness evaluator learned
  the predicate. Diagnostics M036 to M039; workspace WS-9 channels and blog FEAT-12 followers; eval cases
  `fx-ws-9-channels`, `fx-blog-12-followers`, `ws2-private-channels`, `empty-playlists`; the clusterer's topic.
- The conformance walks (round A1 of the road to 1.0.0): five checks the harness runs over every fixture after the
  scenarios, as steps `walk:rule`, `walk:tenant`, `walk:leak`, `walk:fuzz` and `walk:contract`. The rule walk
  compares every operation and action, as every actor and anonymously, with what the IR's rules predict; the
  tenant walk proves a member of another team reaches nothing; the leak walk scans every response for hidden and
  hash columns; the fuzz walk sends wrong types, lengths, keys and ids from a seed kept in the fixture; the
  contract walk requires every breaking change between revisions' OpenAPI documents to be explained by a diff op
  (`diffOpenApi` and `explainedBy` in core) and lists migrations that rewrite a table (`MigrationPlan.rewrites`).
  `--walks`, `--walks rule,fuzz`, `--no-walks` and `--seed` on `pnpm conformance`; the eval runner's full runs
  inherit them.

## 1.0.0-alpha.3 (2026-11-09)

- Read-only fields: `read_only: true` marks a field the API returns and never accepts; register, create and update
  answer 400 when a client sends it. The identity's `role` can be marked the same way; example actors may still
  carry it, written into the database after registration.
- `osl implement`: writes each action handler still at its stub from the action's declaration, the scenarios that
  call it and the backend's own files, checked by the backend's compiler and retried with its output.
- The gap-mining loop: `pnpm evals:generate` and `pnpm evals:round` generate and run rounds of intents, `pnpm
evals:gaps` clusters what agents could not express, the backlog lives in `evals/propose/gaps.yaml`, `pnpm
evals:next` prints the brief for the top open gap, `--resume` regrades a saved run; a nightly round under a cost
  cap.
- Row conditions on rules: `when <field> = <value>` (or `!=`) on any predicate; lists filter by it, row checks test
  it, creates check the body.
- Pages beyond master-detail: `access` on a page, fixed filters with `{actor.id}`, `refresh`, tile `group_by` by an
  enum or a relation, a dashboard or custom page at `/`.
- Schedules and timers: `schedules` (cron, an action run as the system) and `timers` (a row action when a datetime
  field passes, with `after` and `when`), on pg-boss and River; scenarios drive the clock with `timers.run`,
  `schedules.run` and `emails.sent` through test hooks.
- Conditions through relations and conjunctions: `when project_id.public = true` on any predicate and on timers,
  predicates joined with `and`; `any` answers 401 whenever the caller lacks a session an alternative wanted.
- Hidden rows as not found: `rules.hidden: not_found` answers a get, update, delete or row action of a row the
  read rule hides with the 404 a missing row gets.
- Docs: nine design notes from a survey of two hand-written applications (`docs/designs`), three clone exercises
  (`docs/exercises`), the design for membership through any relation, and the road to 1.0.0 (`docs/roadmap.md`).

## 1.0.0-alpha.2 (2026-11-08)

- Rule alternatives joined with `or`, and owner and member paths through relation fields
  (`owner:article_id.author_id`, `member:project_id.team_id`); fixes from the Sonnet eval run.
- Admin actors: an actor may set `role`; the harness writes it after registration.
- The agent evals: `pnpm evals` proposes, validates, generates and runs every case against the harness.
- The five constructs built on 2026-11-05: actions, file fields with a two-step upload and local or S3 storage,
  tenancy with ranked roles plus magic-link and OAuth providers behind an email adapter, page layouts (split,
  table, board, dashboard) and a sidebar app, tooling (queued events, an OpenAPI document, Docker files, seed).
- The 1.0 rebuild: the compiler (model, typed diffs, IR, lock, migrations, drift), three backends (`drizzle-next`,
  `hono-trpc-vite`, `gin-pgx`), the conformance harness and the fixtures.

## 0.1.x

- The OIML era: the schema, Studio, the VS Code extension and the MCP server, now under `legacy/`.
