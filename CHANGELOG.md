# Changelog

Versions are alpha releases of 1.0.0 until the road in `docs/roadmap.md` ends. Each construct is proven by a
fixture intent on all three backends before it is listed here.

## Unreleased

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
