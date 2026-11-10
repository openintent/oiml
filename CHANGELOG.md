# Changelog

Versions are alpha releases of 1.0.0 until the road in `docs/roadmap.md` ends. Each construct is proven by a
fixture intent on all three backends before it is listed here.

## Unreleased

- The proposer's output cap: `osl propose` streams its request and caps one answer at 64,000 output tokens,
  thinking included, where it stopped at 16,000. `--max-tokens` sets the cap on `osl propose`, `pnpm evals` and
  `pnpm evals:round`, and a live run records it in `results.json`. An answer that reaches the cap is reported as
  cut off, once, with the tokens it spent; it used to be retried as a broken answer and recorded at no cost. Round
  6's brief that had been recorded `invalid` was graded under it; the clusterer files a write that depends on the
  caller under role changes whatever the field, and a stamp only one action sets under state machines and
  transitions.
- Invites (round A4 of the road to 1.0.0): `auth.invites` names a membership (the tenancy's, or a junction with a
  relation to the identity and one to the entity people join) and the compiler writes the `<Parent>Invite` entity
  and the `<parent>_invites` resource for it: list, get, delete and a create that mails a link, with `rule` and
  `expires` per entry. An invite becomes a membership only when its email is proven, in one function every proof
  calls: the accept route, a magic-link sign-in, a provider sign-in with a verified email, and a password login
  that carries the invite's token. `GET /api/auth/invites/{token}` says what a link is for and
  `POST /api/auth/invites/{token}/accept` accepts, making the account where the address has none; a role may not
  rank above the inviter's own. The two TypeScript backends serve the link at `/invite/<token>`, and `/login` takes
  `next`. Scenario steps `auth.invite` and `auth.invite_accept`, `invite` on `auth.login`, and `debug.token` on the
  create while emails are captured. Diagnostics M115 to M118, with M072, M084, M121 and M123 grown; `set_auth`
  carries `invites`, and `rename_entity` and `rename_field` follow them. Workspace WS-11 (team invites and a page
  of the pending ones) and WS-12 (invites to a private channel from its page) and blog FEAT-14 (co-authors by
  invite); a sixth conformance walk, `walk:invite`; eval cases `fx-ws-11-invites`, `fx-ws-12-channel-invites`,
  `fx-feat-14-coauthor-invites` and `ws11-join-link-trap`, and `ws1-invites-gap` promoted from a gap to a case with
  expectations; the clusterer's topics for reminders on pending invites and filters on the invite list.
- Pages with parameters (round A3 of the road to 1.0.0): `kind: detail` pages at a path ending `/:id`, which take
  over a resource page's detail when the path is that page's plus `/:id` and stand alone with their own `access`
  otherwise, with `sections` that list other resources filtered by `{row.id}`; and `{tenant.id}` in page, tile,
  section and recent filters, with a switcher in the shell. Diagnostics M095 to M098; workspace WS-10 (a channel
  page, a home dashboard for the chosen team) and blog FEAT-13 (a public author page, an article page whose
  comments section creates); eval cases `fx-ws-10-channel-page-and-team-home`,
  `fx-blog-13-author-and-article-pages`, `ws2-public-project-pages`, `ws2-team-dashboard-files` and
  `empty-org-public-roadmap`.
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
