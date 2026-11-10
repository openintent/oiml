# Backends

A backend turns IR into files for one stack. It is a pure function: the same IR and revision history always produce the same bytes. It also declares how to run what it generated, so the conformance harness and `osl verify` need nothing stack-specific.

## The contract

From `@osl/core`:

```ts
interface Backend {
  name: string; // e.g. "drizzle-next"
  version: string;
  generates: string[]; // model constructs it covers
  generate(input: { ir: IR; revisions: Revision[]; config: ProjectConfig }): GeneratedFile[];
  runtime(config: ProjectConfig): {
    install: Cmd[]; // run in order, cwd = project root
    check: Cmd[]; // compile or typecheck
    serve(port: number): Cmd; // DATABASE_URL, OSL_SESSION_SECRET and PORT are set; DATABASE_APP_URL too under isolation: database
    test(baseUrl: string): Cmd; // contract tests against a running app
    readyPath: string; // answers once the server is up
    migrationsDir(generatedDir: string): string;
  };
  handlerGuide(config: ProjectConfig): {
    language: "ts" | "go";
    files: string[]; // generated files to read before writing an action handler
    conventions: string; // the database client, how to answer with a status, what to return
  };
}

interface GeneratedFile {
  path: string; // relative to the project root
  content: string;
  mode?: "generated" | "scaffold" | "regions";
}
```

Migrations are shared: every backend calls `migrationFiles(revisions, dir)` from core so two backends write identical SQL for the same history. The CLI applies them with core's migrator, so a backend never needs its own.

## What a backend must produce

| Area           | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema         | Tables, columns, enums, foreign keys, indexes and unique constraints exactly as the IR states.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Routes         | One route per operation in each resource, skipping operations whose rule is `none`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Envelopes      | List `{ data, page: { page, page_size, total } }`; get, create (201), update `{ data }`; delete 204. Errors `{ error: { code, message } }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Status codes   | 400 validation, 401 unauthenticated, 403 forbidden, 404 not found (a malformed id is not found), 409 conflict, 503 busy with `Retry-After: 1` for a write that lost to a lock another request holds (see "A lock another request holds").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Validation     | From the IR columns: types, lengths, formats, patterns, ranges, enums. Unknown body keys are rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Rules          | `public`, `authenticated`, `owner:<field>` (set from the session on create; filtered on list; 403 on mismatch), `role:<value>`; alternatives joined with `or`; owner and member paths through relations (`owner:article_id.author_id`), resolved before the check and as subqueries on lists; row conditions (`public when published = true`, `owner:author_id when status != live`) checked on the loaded row, on create bodies with their defaults, and as list filters; conditions through relations (`public when project_id.public = true`) resolved like paths and as subqueries; conjunctions (`member:project_id.team_id and owner:author_id`) where every part must allow; `hidden: not_found` beside the rules answers a get, update, delete or row action of a row the read rule hides with the 404 a missing row gets. |
| Auth           | Register, login, logout, me; cookie sessions signed with `OSL_SESSION_SECRET`; scrypt password hashes; the password column is hidden.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Hidden columns | Never serialized, not even inside included relations, and never accepted from a client.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Events         | Handlers in user-owned files, called after create, update and delete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Hooks          | User-owned before and after hooks around each resource's handlers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Tests          | Contract tests compiled from the model's scenarios, run against `OSL_BASE_URL`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Conformance

```bash
OSL_TEST_DATABASE_URL=postgres://user@host:5432/postgres pnpm conformance            # every fixture, every backend it lists
pnpm conformance blog --backend drizzle-next                                         # one fixture, one backend
pnpm conformance --snapshot-only                                                     # generate and compare only
pnpm conformance --update                                                            # rewrite snapshots after an intended change
```

For each fixture and backend the harness runs: generate, snapshot compare, install, check, create a throwaway database, migrate, drift check, start the server, run the contract tests, drop the database. A fixture with `isolation: database` is run the way it is deployed: the database belongs to a role made for the run that is no superuser (migrations, the worker and the walks' own reads go through it), and the server gets a second connection string, `DATABASE_APP_URL`, for a login that is a member of the model's app role; both roles have random passwords that live in the harness's memory and are dropped with the database. A fixture with a sealed field gets a key made for the run (`OSL_SEAL_KEY`, in the harness's memory and the server's environment only), and before the server is started for the tests it is started twice more, without the key and with a key of 32 characters: it must stop, with a non-zero exit, saying which. The contract tests receive the same `DATABASE_URL` as the server: an actor that carries a `role` is registered through the API and then given it straight in the database, since register refuses it. A backend is accepted when every fixture passes. Snapshots live in `fixtures/<name>/expected/<backend>/` and are the committed proof of determinism.

The TypeScript projects are installed and run with pnpm unless `.osl/config.yaml` says `backend_options.package_manager: bun` or `npm` (`osl init --package-manager bun`). The option changes the install command, the generated `package.json` (the lifecycle-script allowance for esbuild, `pnpm.onlyBuiltDependencies` or bun's `trustedDependencies`) and the README's commands; the scripts themselves are the same, and `dev` is a small launcher (`scripts/dev.mjs`) that works under any of them. `pnpm conformance --package-manager bun` runs the harness with another manager as a spot check; it skips the snapshot compare, since the snapshots are written for pnpm.

## Available backends

| Name             | Stack                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Package                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `drizzle-next`   | TypeScript: Drizzle ORM, PostgreSQL via `pg`, Next.js route handlers, Zod validation, Vitest contract tests. Scaffolds Tailwind CSS 4 and shadcn/ui (config, theme, `cn` helper, the base components below) unless `backend_options.tailwind` or `backend_options.shadcn` is `false` in `.osl/config.yaml`; `npx shadcn add` works afterwards. `backend_options.appearance` is `system` (follows the OS, applied before first paint), `light` or `dark`. Ignores the model's `app` section.                                                    | `@osl/backend-drizzle-next`   |
| `hono-trpc-vite` | TypeScript, one package with two processes: a Hono API hosting a tRPC router (`/trpc`, one router per resource plus `auth`) over Drizzle ORM and `pg`, and a Vite + React + TanStack Router web app typed by that router. Renders the model's `app` section: a shadcn/ui sidebar shell with the pages and a fixed footer (signed-in user with sign-out, settings), one master/detail page per resource page, scaffolds for custom pages, home, sign-in and settings. Tailwind and shadcn are always on; `backend_options.appearance` as above. | `@osl/backend-hono-trpc-vite` |
| `gin-pgx`        | Go: Gin, pgx, `go test` contract tests. Ignores the model's `app` section.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `@osl/backend-gin-pgx`        |

The two TypeScript backends share their generators through `@osl/ts-common` (`packages/ts-common`): the Drizzle schema and client, Zod validation, presenters, event dispatch, the contract-test matchers and the stock shadcn/ui sources. Each backend passes its own conventions (file headers, import aliases), so the shared code never guesses a layout. The shadcn files (components.json, theme, `cn`, the `use-mobile` hook and sixteen components: avatar, badge, button, card, checkbox, dropdown-menu, input, label, select, separator, sheet, sidebar, skeleton, table, textarea, tooltip) are captured verbatim from the shadcn CLI by `pnpm --filter @osl/ts-common sync:shadcn`; nothing in them is hand-edited.

The `hono-trpc-vite` contract tests speak tRPC's HTTP transport but assert the same scenarios: a successful call is the contract's 200 (201 and 204 fold into it), tRPC error codes carry the contract's statuses, and query-string filters are coerced to the typed input. Generated route files under `src/routes` are rewritten on every generate; the shell (`src/components/app-sidebar.tsx`, `app-shell.tsx`), the root route, home, sign-in and settings pages are scaffolds written once, and they read the sidebar's data from `generated/app/nav.ts`, so a later intent that adds a page needs no edits.

## What the constructs since alpha.2 become

| Construct                                                                  | drizzle-next (REST)                                                                                                                                                                             | hono-trpc-vite (tRPC)                                                                          | gin-pgx (REST)                                                                                                                          |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| Actions                                                                    | `POST <resource>/{id}/<name>`, `<resource>/<name>`, `/api/actions/<name>`; handler stubs in `src/actions/<handler>.ts`, filled in by you or `osl implement`                                     | procedures `posts.publish({ id, ...input })`, `actions.send_digest(input)`; same stubs         | the same routes; stubs in Go                                                                                                            |
| Files                                                                      | `POST /api/files`, `PUT`/`GET /api/files/{id}/content`, `POST /api/files/{id}/complete`, `GET /api/files/{id}`; local disk or S3-compatible storage                                             | `files.begin/complete/get` plus the REST content routes on the Hono app                        | the same routes                                                                                                                         |
| Member rules, tenancy                                                      | sessions carry memberships; lists filter by tenant; creators get a membership                                                                                                                   | the same                                                                                       | the same                                                                                                                                |
| Tenant isolation (`auth.tenancy.isolation: database`)                           | every route in `withRequest`: one transaction on the app role's pool with the caller's teams bound; `db` is that transaction, the owner's pool in a job; see below                                                                               | the same, per procedure (a tRPC middleware) and per REST route (Hono)                          | handlers hold a `*db.Scope`: each statement and its `set_config` travel as one batch; `db.System` for jobs                              |
| Membership relations (`member:members`, `member:channel_id.members:admin`) | `withRuleValues(row, session)` looks the caller's junction row up under the path's key and the access module ranks it by the junction's enum; lists filter with a subquery through the junction | the same                                                                                       | `ruleRow(ctx, session, row)` and `access.CheckRow` with `Through` and `Roles`; the list filter as `IN (SELECT ...)` through `where.Raw` |
| Relations through a junction (`relations: { genres: { through: TrackGenre } }`) | a `load<Relation>(ids)` per relation: the junction joined to the far table for the page of rows, in the junction's order or by the far rows' display column; `attachList` and `attachGet` put the far rows on the rows before they are presented | the same                                                                                       | `load<Relation>` on the handler: the links in order, then the far rows they name, grouped by the near key                               |
| Ordered collections (`position: { within: album_id }`)                          | the column has a default the insert trigger overwrites; `POST <resource>/{id}/move` calls `osl_move_<table>(id, to)` and reads the row again; delete calls `osl_remove_<table>(id)`; a reverse include is `with: { tracks: { orderBy } }`        | the same, `move` as a tRPC mutation                                                            | the same statements through the handler's pool or scope; the reverse loader's `ORDER BY`                                                |
| Archive (`archive: true`) | the list's own condition (`isNull(archived_at)`, or `isNotNull` when `?archived=true`); `POST <resource>/{id}/archive` and `/restore` call `set<Entity>Archived(id, archived, now)` in `generated/row-actions.ts`, a conditional update, and answer 409 when it changed no row; the entity's timers are scheduled as after an update, and a timer may run either one | the same, `archived` a boolean of the list input and the two actions tRPC mutations | `archived` parses like a boolean filter and becomes `IS NULL` or `IS NOT NULL` on the `Where`; the two handlers call `rowactions.Set<Entity>Archived`, the same conditional update, and answer 409 when it returns no row |
| Transitions (`transitions: { field: status, approve: { from, to, rule, stamp } }`) | `generated/row-actions.ts` holds `<entity>Transitions`, one function per step over one `UPDATE ... WHERE id = $1 AND status IN (from) RETURNING *`; `POST <resource>/{id}/<step>` loads the row, checks the read rule and the step's rule, calls it and answers 409 `invalid_transition` when no row came back; a timer calls the same function as the system and schedules the entity's timers again; a board grouped by the field drags along the steps (below) | the same, each step a tRPC mutation; the code travels as the cause of a `CONFLICT` | package `generated/rowactions`: `Transition<Entity><Step>(ctx, db, id, now)` with the same statement, `nil` when it matched no row; the handler answers 409 `invalid_transition`; `run<Timer>` in the scheduling package calls it through the system's pool |
| Counts (`count_of: comments`) | none beyond the column: `integer NOT NULL DEFAULT 0`, read-only, kept by the database (see below); filters, sorts and tiles read it like any integer | the same | the same |
| Field rules (`read: "member:team_id:admin"` on a field) | `generated/present.ts` holds the field rules and `present<Entity>(row, viewer)`: the field is optional in the public type and set only when `reads(rule, viewer, row)` allows; the viewer is the request's session for an answer and `SERVER` for an event's payload; `auth.me` answers `fields` beside `data`; the pages read it through `fieldsOf(session)` (see below) | the same; the viewer is `ctx.session`, and `fields` is on `auth.session` | `models.Present<Entity>(row, viewer)`: the field is a `models.Maybe[T]` with `json:",omitzero"`; `access.Viewer(session)` checks the rule, `models.Server` reads everything; `auth` gets `auth.Visibility` from the app |
| Money (`type: money`, `currency` or `currency_field`) | `numeric({ precision: 19, scale: 4 })`, which the driver hands over as the string the database printed; `generated/validation.ts` carries `money(min?, max?)`: a string of the amount's shape and nothing else, bounds compared as BigInt ten-thousandths; a filter is the same string and `eq`; an update that changes a currency field answers 400 unless the amounts in it come along; the pages take it in a text input beside its currency and show it with `formatMoney` (see below) | the same; the 400 is a `BAD_REQUEST` with code `validation` | `string` and `*string` in the row and public structs, selected as `"total"::text`; `validation.Money{Min, Max}` unmarshals a JSON string only and compares bounds as `big.Int`; the same refusal in `Update` |
| Sequences (`type: sequence`) | none beyond the column: `varchar(255) NOT NULL DEFAULT ''`, read-only, written by a `BEFORE INSERT` trigger (see below) and read back by the insert's `RETURNING`; the fields of its scope are left out of update; filters, sorts and search read it like any string | the same | the same |
| Sealed fields (`sealed: true` on a string or text) | the column is `bytea()`; `generated/seal.ts` has `seal`, `unseal` and `atRest`: a write is sealed before its hook and its insert, and `present<Entity>` opens the value inside the field rule's branch, never for `SERVER`; a value that does not open throws a `SealError`, logged with the column and answered 500; the key is `OSL_SEAL_KEY`, checked in `instrumentation.ts` and `startWorker` (see below) | the same; the key is checked as `generated/server/app.ts` loads | `[]byte` in the row struct, `Maybe[string]` in the public one; `generated/seal` has `Seal`, `Open` and `Load`; the handlers seal a written string in `Create` and `Update`; `PresentX` calls `seal.MustOpen` inside the rule's branch, never for `models.Server`; a failure panics into a recovery that answers 500; `app.Start` loads the key |
| Typed JSON (`shape:` on a json field) | `jsonb().$type<EntityField>()` with the value's type exported beside the table; the Zod object of the shape in the create and update inputs, with a catch-all that refuses an unknown key under its own path; a 400 lists `{ path, message }`; the pages render a group of inputs | the same; the 400's message is Zod's list of issues | `json.RawMessage` in the row, as stored; `validation.Shape{Keys}` in the input objects answers the same paths; a struct per shape in `generated/models/shapes.go` for a handler to decode into |
| A shape per enum value (`shape_by:`) | `<resource><Field>Shapes` in `generated/validation.ts`, one Zod object per value; `create` and `update` call `fitShape` with the shape of the enum value the row will have (the body's, else the loaded row's), and `update` answers 400 when the enum changes and the value was not sent; the pages show the group of the select's value | the same; the refusal is `BAD_REQUEST` with `<path>: <what is wrong>` | `validation.<Resource><Field>Shapes`, a map by value; the same two steps in `Create` and `Update` |
| Schedules, timers                                                          | pg-boss cron schedules and jobs with `startAfter`; a timer job reloads the row and runs the action only if the row still says so; test hooks at `/api/osl-hooks/*` when `OSL_TEST_HOOKS=1`      | the same, with the hooks as REST routes beside tRPC                                            | River periodic jobs (robfig/cron) and `ScheduledAt` jobs; the same hooks                                                                |
| Magic links, OAuth                                                         | `POST /api/auth/magic-link`, `/verify`, `GET /api/auth/oauth/<name>[/callback]`, `GET /api/auth/providers`; email through log, Resend or capture                                                | procedures `auth.magic_link`, `auth.magic_link_verify`, `auth.providers`; OAuth as REST routes | the same routes                                                                                                                         |
| Queued events                                                              | pg-boss in the `pgboss` schema; the worker runs in the Next.js process from `instrumentation.ts` or alone with `tsx src/worker.ts`; `OSL_ROLE=web                                               | worker                                                                                         | all`                                                                                                                                    | pg-boss; `src/server/main.ts` starts it; `src/server/worker.ts` alone | River; `river_%` tables are left alone by drift |
| OpenAPI                                                                    | `generated/openapi.json`, `GET /api/openapi.json`                                                                                                                                               | not applicable (tRPC)                                                                          | the same as REST                                                                                                                        |
| Seed                                                                       | `tsx generated/seed.ts` replays `examples.seed` over HTTP; `osl seed`                                                                                                                           | the same over tRPC                                                                             | a Go program                                                                                                                            |
| Docker                                                                     | `Dockerfile`, `docker-compose.yml` with postgres and, with queued events, a worker service                                                                                                      | the same                                                                                       | the same                                                                                                                                |
| App pages                                                                  | `app/(app)/…` with the sidebar shell, React Query over the REST client; page access gates, fixed filters, refresh intervals and grouped tiles                                                   | `src/routes/…` with TanStack Router over the tRPC client; the same                             | none                                                                                                                                    |
| Rules with conditions, paths and conjunctions; hidden rows                 | checks from the generated access module shared with the Vite backend; lists filter by the row condition and through relations with subqueries; a hidden row answers `notFound()`                | the same                                                                                       | `access.CheckRow` over the values `ruleRow` resolves, `where.Raw` subqueries, `httpx.NotFound()`                                        |
| Read-only fields, `osl implement`                                          | strict input schemas answer 400 when a client sends the field; handlers written from the action, its scenarios and the files `handlerGuide` names, checked with `tsc`                           | the same                                                                                       | the same, with `gofmt` first                                                                                                            |
| Invites (`auth.invites`)                                                   | `POST /api/<parent>_invites` through `issue<Parent>Invite`, `GET /api/auth/invites/{token}`, `POST …/accept`; `acceptPending` in `generated/auth-providers.ts`; the page at `/invite/<token>`   | `<parent>_invites.create`, `auth.invite`, `auth.invite_accept`; the token routes as REST too   | the same routes; `Issue<Parent>Invite`, `AcceptPending` in `generated/auth/providers.go`; the mail is `email.Invite`; no page           |

Every one of these is proven by the fixtures: `blog` (actions, files, search and sort, magic link and GitHub providers, table and dashboard pages, a queued event, seed, invites to co-author an article), `todo` (actions, board and table pages, a dashboard, seed) and `workspace` (teams, memberships with ranked roles, member rules, auto-membership, magic link, invites to the team and to a private channel). A fixture may ship the user-owned code its scenarios depend on under `fixtures/<name>/overlay/<backend>/`; the harness copies it over the generated project before installing. Snapshots cover generated files only.

The generated `package.json` is a `merge` file: keys OSL adds later (a dependency a new feature needs, a script) land on the next generate, keys you changed or added are kept.

Environment the features read: `OSL_STORAGE` (`local` default, `s3` with `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` for R2, MinIO or Supabase, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`), `OSL_STORAGE_DIR`, `OSL_MAX_UPLOAD_BYTES`; `OSL_EMAIL` (`log`, `resend` with `RESEND_API_KEY` and `EMAIL_FROM`, `capture` for tests, where sign-in responses carry the token); `OSL_APP_URL` (where magic links and OAuth return); `OAUTH_<NAME>_CLIENT_ID` and `_CLIENT_SECRET`; `OSL_ROLE`. The harness runs with `OSL_EMAIL=capture` and local storage.

## Invites

`auth.invites` reaches a backend as ordinary IR and three additions. Core writes the invite entity and resource
into the IR, so the table, the validation, the presenter, the list, get and delete handlers, the OpenAPI paths and
the pages over the resource come from the generators a backend already has. `ir.auth.invites` lists each invited
membership with its parent, its role column and ranks, the relations from the parent to the tenant and the link's
lifetime in seconds, and the invite resource's create operation carries `invite: <Membership>`. From those a
backend writes three things.

- **The create.** Where an operation carries `invite`, the create handler checks the rule as any create does and
  hands the body and the resource's before-create hook to one function per membership (`issue<Parent>Invite`,
  `Issue<Parent>Invite` in Go). In order it applies the role ceiling (403 when the inviter holds a membership of
  the parent and asks for a role above it), answers 409 for a live invite to the address and for a member's
  address, lets a lapsed invite give way, stores the token's hash and never the token, and mails the link
  `OSL_APP_URL/invite/<token>`. The row is kept only if the mail was handed to the adapter. The answer is a
  create's 201 and, under `OSL_EMAIL=capture`, `debug: { token, url }` beside `data`, which is how a scenario and
  the walks come by a token.
- **`acceptPending(user, provenEmail)`.** Written once per language, in `generated/auth-providers.ts` and
  `generated/auth/providers.go`. It does nothing unless the proven address is the account's own. Then every live
  invite to the address becomes a membership, each in a transaction that deletes the invite first, so two proofs
  that race accept once, and a membership that exists already is left as it is. A membership it makes dispatches
  the membership's created events, as a create through the resource does. Four places call it and nothing else
  makes a membership from an invite: the magic-link verify, the provider callback when the provider calls the
  email verified, the password login when its body carries `invite` (a live token to the account's own address),
  and the accept route.
- **The token routes.** `GET /api/auth/invites/{token}` says what the link is for (the parent's name, the role,
  the inviter's name, the address masked, whether it has an account) and accepts nothing, since mail scanners open
  links. `POST /api/auth/invites/{token}/accept` answers as the reference says: 200, 403, 401, or 201 with an
  account made from the body and signed in. Both answer 404 for a token that is unknown, used or revoked and 410
  for a lapsed one, and a body the new account cannot be made from is a 400. They carry no rule, so they sit with
  the auth routes; OpenAPI lists them as `auth_invite` and `auth_invite_accept`.

The two TypeScript backends take all of it from `@osl/ts-common` (`invites.ts`, the mail in `email.ts`) and render
the link's page from `generated/app/invite.tsx`. `/invite/<token>` shows the lookup and offers the way in that
fits: Accept to a session under the address, the account form where the address has no account, and a sign-in
that returns to the link (`/login?next=`) where it has one. `/invite/accepted` is where a provider sign-in that
accepted returns to, and every reply with `accepted` lands the invitee the same way: the first entry's tenant
becomes the current one and its row opens where the app shows it. `hono-trpc-vite` serves the same functions as
procedures (`<parent>_invites.create`, `auth.invite`, `auth.invite_accept`) with the two token routes as REST
beside them. Its sign-in procedures answer `{ data, accepted }` and its invite create `{ data, debug }`, where
REST puts those keys beside `data`, and a single call answers with the status its refusal carries, so a lapsed
invite is a 410 on both transports. `gin-pgx` has the API and no page. The mail is the email adapter's plain text
on all three.

## Writing a backend

1. Copy the shape of `packages/backend-ts` or `packages/backend-vite`. Keep each generator a function from IR to a string; a TypeScript backend takes the shared generators from `@osl/ts-common`.
2. Produce the migration files with `migrationFiles` from core.
3. Mark user-owned files `scaffold` and env files `regions`.
4. Declare the runtime commands as a function of the project config (the TypeScript backends take the install command from `installCommand` in `@osl/ts-common`), including `seed` and, when other tooling owns tables, `ignoredTables`.
5. Declare the handler guide: the generated files `osl implement` shows the model and the stack's conventions in a few lines (the database client, the error helper that answers with a status, what a handler returns).
6. Register the backend in `packages/conformance/src/index.ts` and `packages/cli/src/backends.ts`, add it to each `fixtures/*/fixture.yaml`, and run the harness with `--update` to create its snapshots.
7. Keep iterating until every fixture passes every step. The harness output names the failing step and keeps the temp project with `--keep`.

## Tenant isolation in the database

With `auth.tenancy.isolation: database` the migrations, which every backend shares, carry the backstop
(`packages/core/src/isolation.ts`), and each backend binds a request to its caller's tenants.

| Piece                 | What is generated                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant column         | the tenant entity's key, the declared relation, or a derived column (`team_id`) that is the table's and never the entity's: no backend reads or writes it. A `SECURITY DEFINER` trigger copies it from the parent on insert and when the relation changes; `UNIQUE (tenant, key)` on the parent and a composite key `(tenant, relation)` keep every relation between tenant tables inside one tenant |
| Policies              | `ENABLE ROW LEVEL SECURITY` (not `FORCE`: the owner is not bound, so it need not be a superuser), `<table>_tenant` for all commands: the row's tenant is among those in `app.<tenant>_ids`, an array literal the request binds; unset or empty shows no row. `<table>_public_read` for SELECT only, from the read rule's public alternatives                                                         |
| Roles                 | `<app>_app`, created `NOLOGIN` and idempotently (roles belong to the cluster), granted the tables. `DATABASE_URL` is the owner (migrations, the queue, the worker); `DATABASE_APP_URL` is what requests connect as. `osl migrate` reads `DATABASE_APP_URL` and gives that login its password, so no secret is in a generated file                                                                    |
| Functions past policy | `osl_memberships(user)` (a session is read before any tenant is bound), `osl_exists_<table>(id)` (another tenant's row answers the rule's 403 or 401, a missing one 404; absent under `hidden: not_found`), `osl_read_<table>_<path>(key)` (the value a public alternative tests on another table). Each is owned by the migrating role and granted to the app role alone                            |
| Boot check            | the app refuses to serve when `DATABASE_APP_URL` connects as a role the policies do not bind (`row_security_active` is false for a tenant table): the owner, a superuser, `BYPASSRLS`                                                                                                                                                                                                                |
| Drift                 | `osl drift` compares row security per table (and reports `FORCE`), every policy's command and expression, the functions' bodies and `SECURITY DEFINER`, and the triggers                                                                                                                                                                                                                             |

The TypeScript backends open one transaction per request (drizzle-next: `withRequest` in every route file;
hono-trpc-vite: a middleware on `publicProcedure`, so a batch runs each call in its own, and one on `/api/*`) and
bind the session's memberships with `set_config(..., true)`. `db` in `generated/db/client.ts` is a proxy over an
`AsyncLocalStorage` scope: the request's transaction inside a request, the owner's pool inside `asSystem` (the
worker's jobs and the timer and schedule hooks), the unbound app role anywhere else, which reads no tenant row. Jobs
a request queues are sent after its transaction commits. gin-pgx keeps one statement per transaction: `*db.Scope`
has the pool's `Query`, `QueryRow`, `Exec` and `Begin`, and sends each statement in one batch with its
`set_config(..., true)`, which PostgreSQL runs as one transaction, so nothing stays on a pooled connection and a
pooler in transaction mode is safe. A request's context carries the binding (`db.WithBinding` in a middleware,
`db.Bind` when `auth.Session` has read the memberships); a context nothing was bound in reaches no tenant row.

## Ordered collections in the database

A position field's order lives in the database, so that every writer keeps it: a generated handler, an action
handler of yours, a seed, a cascade. `orderObjects` in `packages/core/src/order.ts` renders the objects, the
migrations create and drop them like the isolation layer's, and `osl drift` compares the functions and triggers.

| Piece                         | What is generated                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Column and constraint         | `position integer NOT NULL DEFAULT 0` (the trigger overwrites the default) and `UNIQUE (parent, position) DEFERRABLE INITIALLY IMMEDIATE`: checked when a statement ends, so one statement renumbers a parent. A table that has rows is numbered parent by parent before the constraint arrives                                          |
| Append                        | `osl_position_<table>()`, `BEFORE INSERT FOR EACH ROW`: waits for the parent's row `FOR NO KEY UPDATE`, then takes the place after the last. It takes no other row, since the checks of the row's own relations still follow                                                                                                             |
| Move and remove               | `osl_move_<table>(id, to)` and `osl_remove_<table>(id)`: `osl_hold_<table>(parent)` waits for the parent's row, then takes every row of the parent `NOWAIT`; when one is held it gives back what it took and asks again (up to about ten seconds, then `lock_not_available`, answered 503 `busy`). One statement numbers the parent 1..n |
| A delete that comes otherwise | `osl_close_<table>()`, `AFTER DELETE FOR EACH STATEMENT` over the deleted rows: a cascade or a handler's own `DELETE` already holds its rows, so the parent and its rows are taken only if free, and the parent renumbered; otherwise the gap stays until that parent's next move or remove                                              |
| Under `isolation: database`   | the functions are `SECURITY DEFINER` (the rows of one parent may be several tenants'), `move` and `remove` test the row against the tenant policy's expression themselves and are granted to the app role; the trigger functions are granted to nobody                                                                                   |

No writer waits for a row while it holds rows of the parent, which is what a deadlock needs.
`packages/core/test/order.database.test.ts` runs 24 connections of appends, moves, removes, plain deletes and
cascades from the far side of a junction against a real database (with `OSL_TEST_DATABASE_URL` set) and expects no
failed statement, no shared place, and 1..n after the parent's next move; its control takes the lock out of the
append trigger and expects the unique constraint to refuse one of two appends. One thing the database cannot order
is yours: a transaction of your own that writes two parents takes their locks in the order it writes them.

## Counts in the database

A `count_of` field is kept by the database, so that every writer keeps it: a generated handler, an action handler
of yours, a seed, a cascade, a TRUNCATE. `countObjects` in `packages/core/src/counts.ts` renders the objects;
`databaseObjects` is the one list of the isolation layer's, the ordered collections' and the counts', which the
migrations create and drop together and `osl drift` compares.

| Piece                       | What is generated                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Column                      | `<count> integer NOT NULL DEFAULT 0` on the counting table; no backend writes it                                                                                                                                                                                                                                                              |
| Function                    | `osl_count_<table>_<count>()`: from the statement's rows (transition tables) it adds up, per parent, the rows the conditions of `where` hold for, and writes `count = count + n` once per parent in key order. The write waits for the parent's row, which is what makes the number exact                                                    |
| Triggers                    | four on the counted table, `AFTER ... FOR EACH STATEMENT`: insert, delete, update (every update: a trigger with transition tables takes no column list; it writes nothing when neither the relation nor a field of `where` changed) and truncate                                                                                              |
| Backfill                    | the migration that adds the field to a table that exists, or changes what it counts, sets it with one `UPDATE ... SET <count> = (SELECT count(*) ...)`; listed as a table rewrite                                                                                                                                                             |
| On an ordered table         | where the counted rows are ordered within the relation they are counted by, `osl_count_hold_<table>()`, `BEFORE INSERT FOR EACH ROW` (it fires before the order's own trigger): key shares on the rows the new row points at, then `osl_hold_<table>(parent)`, the parent and every row of it as a move takes them                            |
| Under `isolation: database` | the functions are `SECURITY DEFINER` with `EXECUTE` revoked from everyone: a count is written whoever the caller is bound to, onto a tenant's row or a shared one, and reads and returns nothing. A count on a shared row over a tenant table adds up every tenant's rows (M156)                                                              |

Every writer of a counted row holds that row and then waits for the counting row. On an ordered table the hold
before an append makes that safe against the order's own writers: `packages/core/test/order.database.test.ts` runs
its load a second time with a count in place, and no writer fails. A writer that goes the other way, the counting
row first and a counted row second, can meet one of them: a delete of the counting row against a delete of one of
its counted rows, or a transaction of your own that writes a counted row and then another row of the same parent.
PostgreSQL ends such a pair by failing one side (`deadlock_detected`, answered 503 `busy`), and the count stays exact;
`packages/core/test/count.database.test.ts` runs both loads, and a control that writes the increments from a value
read before the row was held ends with counts that are short.

## A lock another request holds

Three database errors mean that a statement lost to another request and did nothing, which is neither the
caller's fault nor the server's: `lock_not_available` (SQLSTATE `55P03`: a move or a remove on an ordered table
that gave up after about ten seconds of a held row), `deadlock_detected` (`40P01`: two writers that each waited
for a row the other held, ended by PostgreSQL failing one of them, as a delete of a counting row against a write
of one of its counted rows can) and `serialization_failure` (`40001`: only where the database runs above read
committed). Each backend maps them where it maps every database error, so the answer is the same for a generated
handler, an action handler of yours and a hook:

| Backend        | Where                                                              | The answer                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| drizzle-next   | `handleError` in `generated/http.ts` (`busy()`)                    | 503, `Retry-After: 1`, `{ "error": { "code": "busy", "message": "Another request is changing the same rows. Try again." } }`                                                                                            |
| gin-pgx        | `httpx.HandleError` in `generated/httpx/httpx.go` (`httpx.Busy`)   | the same                                                                                                                                                                                                                |
| hono-trpc-vite | `toTRPCError` in `generated/server/errors.ts` (`busy()`, `isBusy`) | a `TRPCError` with the code `SERVICE_UNAVAILABLE` (HTTP 503 in tRPC 11) and the same message; `responseMeta` in `generated/server/app.ts` adds `Retry-After: 1`, in a batch too; the REST routes answer `busy` as above |

Nothing is logged for it (PostgreSQL's own log has the deadlock and who was in it), and the OpenAPI document names
the 503 on every write beside its other error answers. The server does not run the request again: a handler has
hooks and events around its statement, and replaying one is a change of its own, which a later round could make
for the statements that are safe to repeat (a `move`, a delete) once it says what a hook sees. Until then the
caller sends the same request again; the generated web client raises the answer like any other error and does not
repeat a mutation. The harness's walks still count any 5xx as a failure, a 503 included: none appears in a walk,
and one that did should be reported.
`packages/conformance/test/busy.test.ts` runs the two TypeScript mappers and reads the Go one.

## Sequences in the database

A `type: sequence` field is numbered by the database, so that every writer gets a number: a generated handler, an
action handler of yours, a seed, an `INSERT` someone types. `sequenceObjects` in `packages/core/src/sequences.ts`
renders the objects, and they join `databaseObjects` with the isolation layer's, the ordered collections' and the
counts'.

| Piece                       | What is generated                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------- |
| Column                      | `<number> varchar(255) NOT NULL DEFAULT ''` and `UNIQUE (<scope...>, <number>)`; no backend writes it                                                                                                                                                                                                                                                |
| Counter table               | `osl_sequences ("sequence", "scope", "last")`, one row per sequence (`<table>.<column>`) and scope (the scope's values as a JSON array in text; `[]` for one counter per table); made with the first sequence, dropped with the last, never made again in between; `osl drift` expects it                                                            |
| Function                    | `osl_sequence_<table>_<column>()`: `INSERT INTO osl_sequences ... VALUES (..., 1) ON CONFLICT ("sequence", "scope") DO UPDATE SET "last" = s."last" + 1 RETURNING s."last"`, then `NEW.<number> := <prefix>                                                                                                                                          |     | lpad(...)`; whatever the writer put in the column is overwritten |
| Trigger                     | `osl_sequence_<column>`, `BEFORE INSERT FOR EACH ROW`. By name it fires after `osl_count_hold` and `osl_order_assign`: on a table that is also ordered or counted every insert takes the parent first and the counter last                                                                                                                           |
| Migrations                  | a sequence that arrives on a table with rows numbers them scope by scope in `created_at`, key order (`backfill_sequence`, listed as a table rewrite) before the unique constraint, and seeds the counters after; a renamed table or field keeps its counters; a changed scope starts each new scope after the largest number its rows carry (warned) |
| Under `isolation: database` | the web role has no grant on `osl_sequences`; the functions are `SECURITY DEFINER` with `EXECUTE` revoked from everyone and touch the one counter the new row names. A row the policy then refuses takes its statement, and the counter's step, back                                                                                                 |

The counter's row is written in the create's own transaction and held until it ends. Two creates in one scope
therefore never share a number, and the second waits for the first; a create that rolls back gives its number
back, so a scope's numbers are consecutive and a hole appears only where a row was deleted later.
`packages/core/test/sequence.database.test.ts` runs 24 connections of creates in three scopes and one table-wide
counter (alone, two in a statement, two in a transaction, rolled back on purpose) against a real database and
expects no failed statement and each scope numbered 1..n; its control reads the counter without holding it and
expects unique violations. The order's and the count's database tests run their loads again with a sequence on the
ordered and the counted table. What the database cannot order is yours, as with an order: a transaction of your own
that creates in two scopes takes their counters in the order it writes them.

## Money, a decimal string end to end

| Where                 | drizzle-next and hono-trpc-vite                                                                                                                           | gin-pgx                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A request body        | `money()`: `z.string()` held to `^-?\d{1,15}(\.\d{1,4})?$`; a JSON number fails `z.string()`, so nothing is converted or rounded                          | `validation.Money`: `json.Unmarshal` into a `string`, then the same pattern                                     |
| `validate.min`, `max` | decimal strings in the model; compared as BigInt ten-thousandths, only on a value that has the shape                                                      | compared as `big.Int` ten-thousandths                                                                           |
| The database          | the string is the statement's parameter; `numeric(19, 4)` comes back as text (`"19.9900"`), which node-postgres does not parse                            | the string is the parameter; the column is selected as `::text`, so the row struct holds what PostgreSQL prints |
| An answer, an event   | the presenter passes the row's string on; an included row goes through the same presenter                                                                 | the same                                                                                                        |
| A filter, a sort      | the query value is checked with `money()` and compared with `eq`; `ORDER BY` is the column's own                                                          | `Money.ParseString`, then `"total" = $n`                                                                        |
| OpenAPI               | `{ type: string, format: decimal, pattern }` with the currency and the bounds in the description                                                          | the same document                                                                                               |
| Pages                 | `<Input type="text" inputMode="decimal" pattern>` with the currency beside it; `formatMoney(value, currency)` groups digits and trims zeros on the string | no pages                                                                                                        |
| Generated tests       | scenario bodies and expectations carry the strings the model wrote                                                                                        | the same                                                                                                        |

An update that changes a `currency_field`'s field while the row holds an amount in it must send that amount too:
the handlers compare the body with the row they loaded for the rule and answer 400 `validation` naming the amount.
`packages/cli/test/money.test.ts` evaluates the generated validator and formatter on amounts a float cannot hold.

## Sealed fields, one format on every backend

A sealed value is stored as `0x01 || nonce (12 random bytes) || ciphertext || tag (16 bytes)`: AES-256-GCM under
the 32 bytes `OSL_SEAL_KEY` spells as 64 hexadecimal characters, with the associated data `0x01` followed by
`<table>.<column>` in UTF-8. `packages/core/src/seal.ts` is the reference and holds four fixed vectors; a backend
that stores other bytes for one of them, or does not open one, has left the format, and a database would no
longer move to it. The vectors are in the reference's test, in `generated/tests/00_sealed_values.test.ts` of the
TypeScript projects and in `generated/seal/seal_test.go`; `packages/conformance/test/sealed.test.ts` runs the
generated TypeScript and Go against each other, through a `bytea` column of a real database when one is there.

| Where                | drizzle-next and hono-trpc-vite                                                                                     | gin-pgx                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| The key              | `sealKey()` reads `OSL_SEAL_KEY` once; unset, not hexadecimal or not 64 characters throws a `SealError`             | `seal.Load()` answers an `*seal.Error`                                        |
| The start            | `instrumentation.ts` and `startWorker` (Next.js), `generated/server/app.ts` (Hono): no key, no server               | `app.Start`, which `cmd/server` and `cmd/worker` call                         |
| A write              | `atRest("<table>", values)` before `beforeCreate` and `beforeUpdate`: a string becomes bytes, null and absent stay  | `values["<column>"] = seal.Seal(seal.<TableColumn>, plain)` before the hooks  |
| The row in the code  | `Uint8Array`; inside an included row it arrives as `\x` and hexadecimal, which `unseal` reads too                   | `[]byte`, nil for NULL                                                        |
| An answer            | `if (viewer !== SERVER && reads(rule, viewer, row)) out.f = unseal("<table>.<column>", row.f)`                       | `if viewer != Server && viewer.Reads(...) { out.F = Shown(seal.MustOpen(…)) }` |
| An event, a session  | presented as `SERVER`: no sealed value                                                                              | presented as `models.Server`: no sealed value                                 |
| A value that fails   | `SealError`, logged as `[seal] <table>.<column>: …`, answered 500 `internal`                                         | a panic the app's recovery logs and answers 500 `internal`                    |
| Your own code        | `unseal("<table>.<column>", row.<column>)`, `seal(...)`                                                             | `seal.Open(seal.<TableColumn>, row.<Column>)`, `seal.Seal(...)`               |
| Files with the key   | none: `.env.example` has `OSL_SEAL_KEY=`, the compose file `${OSL_SEAL_KEY:?…}`                                     | the same                                                                      |

Nothing is added to the database for a sealed field, under `isolation: database` either: the column is a `bytea`
on a table whose policies are the tenancy's, and the value is opened in the app for a row the policy let through.
A sealed field cannot be renamed, and no field becomes sealed or stops being sealed: `applyDiff` refuses both,
since a migration has no key.

## Transitions and the compiler's row actions

A transition adds nothing to the database: no trigger, no function, no policy. The guard is the statement itself,
`UPDATE <table> SET <field> = <to>[, <stamp> = <now>] WHERE <key> = $1 AND <field> IN (<from>) RETURNING *`, so of
two requests at once one moves the row and the other finds it gone from `from`. A request answers in this order:
the action's rule without a row (401, 403), the row loaded (404; under `isolation: database` a row of another
tenant does not come back and the existence probe answers what the rule would), the read rule under
`hidden: not_found` (404), the transition's rule on the row (401, 403), then the statement, 409 `invalid_transition`
when it returned no row. A caller the rule refuses is never told the state.

`archive`, `restore` and every transition are one statement on one row, and each backend keeps them in one
module, `generated/row-actions.ts` (`generated/rowactions` in Go), so that the request handlers and the timers run
the same code. A timer runs the statement as the system (under `isolation: database` through the owner's pool, as
it runs a handler), and, the row being written, schedules the entity's timers again: a second timer can wait on
what the first one stamped. A transition whose rule is `none` has no route and is in that module for a timer
alone. `move` is not there: it needs a place, which a timer cannot give (M133).

A board page grouped by the field of the entity's transitions is generated from the same table. `MOVES` lists each
transition with a route, its `from`, its `to`, the viewer's rule as the page can evaluate it, and the client call;
a column takes a drop only when one of them takes the dragged card there from its column (no other column answers
`dragover`, so the browser shows no-drop and the card never leaves); the drop runs that transition, moves the card
at once and puts it back when the API refuses (a stale card's 409, a rule that depends on more than the page
knows). The page never calls update for the field. A board over any other enum updates the field as before.

## Fields with a read rule

`read:` on a field adds nothing to the database and changes one thing in the generated code: the function that
turns a row into its public shape takes the viewer. That function is the only way to the shape on every backend,
and for an entity with a field rule a call without the viewer does not compile, so every way a row leaves the
server passes through it: get, the rows of a list, included rows and the far rows of a relation through a junction,
the answers of create and update, of `move`, `archive`, `restore` and every transition, of an action that returns
the row, and `auth.me`, register and login. An entity without a field rule keeps the presenter it had, so a model
without `read:` generates what it did.

| Who the row goes to                  | The viewer                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| The caller of a request              | their session, or none: each field rule is checked for them on that row              |
| The creator of a new tenant          | their session with the membership the same request made                              |
| The caller, of their own row         | their own session: `auth.me`, register and login answer what `read:` lets them read  |
| An event's handler, inline or queued | the server: every field with a read rule, no hidden one, whoever caused the event    |
| An action or a hook                  | none: it gets the row itself                                                         |
| The session, for its rules           | the server: `session.user` is the whole row, and never leaves as it is               |
| A webhook, an audit entry            | not generated yet; the round that adds them presents the row to the party it goes to |

A field rule reads the row's own columns and the session, so the presenter looks nothing up: no query per row, no
path, and under `isolation: database` nothing that runs under the policy. The rule is compiled as written there
(the membership M128 adds to an entity rule is not added), and the test hook that switches the rule checks off
does not switch it off: the presenters call `judge` (`judgeRow` in Go), the verdict without the hook.

The key is absent, not null. In TypeScript the property is optional and the presenter leaves it unset; in Go a
`Maybe[T]` reports itself zero until the presenter calls `Shown`, and `omitzero` leaves the key out. In the OpenAPI
document the property leaves `required` and its description says for whom it is there.

`fields` beside `data` on `GET /api/auth/me` (on `auth.session` under tRPC) says, per resource, whether the caller
could read each such field on some row: the rule before any row, and for a member predicate whether a membership
of that rank is held at all. The pages read it with `fieldsOf(session)` (a visitor's answer is compiled in from the
rules): a table leaves out the column, a new-row form the input. Where the question is about one row, the row's
own keys answer: the detail pane leaves the field's row out and the edit form its input, and neither form sends a
field it did not offer. A rule's condition on a field with a read rule is left to the API, as a path through a
relation is.

## The conformance walks

After the scenarios, the harness runs seven checks over every fixture that no scenario names, each a function of
the IR, the running app and the actors' sessions, reported as steps `walk:rule`, `walk:tenant`, `walk:order`,
`walk:leak`, `walk:fuzz`, `walk:contract` and `walk:invite` (`--walks` runs them alone, `--walks rule,fuzz` a few, `--no-walks`
skips them).

- **rule**: for every resource operation and action, every actor and an anonymous caller, the harness computes what
  the IR's rule predicts (allowed, 401, 403, or 404 under `hidden: not_found`) and compares it with the answer. It
  makes one row per actor the create rule allows (and tests the refused creates), walks an entity nobody may
  create on an existing row, and resolves owner and member paths, conditions through relations and memberships
  straight from the database. The step's detail counts what the predictions said, so the coverage is visible. On
  an archiving entity the prediction leaves an archived row out of the list, expects 200 from `archive` on a live
  row and 409 on an archived one (the reverse for `restore`), and after each one that went through looks for the
  row in the caller's plain list and in the one asked with `archived=true`. A transition is predicted the same
  way: the rule first, then 200 when the row's state is one the step starts from and 409 when it is not; after one
  the rule allowed, the walk reads the row and wants the field at the step's `to` (and its stamp set) or where it
  was. The detail says how many allowed calls moved a row and how many answered 409. Before and after its deletes
  the walk compares every count of the model with the rows the database holds.
- **tenant**: with tenancy, a member of another team (an actor outside the home team, or a user the walk registers)
  gets, updates, deletes and runs actions on the home team's rows and must be refused with the rows unchanged, lists
  nothing of theirs, and cannot create a row under one of their parents. A row the read rule opens to a caller
  with no session (`public`, or `public when` a condition the row meets) may be read and listed, since the model
  says so, and is still checked for every write; the step's detail counts those rows. With `isolation: database` the walk runs a second time with the generated rule
  checks switched off (`POST /api/osl-hooks/rules/off`, only under `OSL_TEST_HOOKS=1`): what still refuses is the
  database. A control comes first (a list the rules refuse a caller without a session must now answer, empty), or
  the pass would prove nothing. Then the unbound probe (`GET /api/osl-hooks/tenancy/unbound`): the app's database
  role with no tenant bound must read no row of any tenant table except exactly the rows a public read rule opens,
  which the harness computes from the rules.
- **order**: on every entity with a position field, bursts of eight calls at once into one parent, as a caller who
  may make its rows: eight creates, then a move of every row, then creates, moves and deletes together. No call may
  fail (a create may meet a unique pair, 409), and after each burst the harness reads the parent's rows from the
  database: every place once, 1..n, and the list in that order where the resource lists in the entity's own. It
  ends by comparing every count of the model with its rows: the counts over an ordered table were written inside
  each of those calls. On every entity with a sequence field it then sends eight creates at once into the scope of
  a row the walk made: none may fail, and the numbers the database gave them must be eight in a row, with no number
  twice in any scope.
- **leak**: every response body of the walks is scanned for hidden columns, the password, key and token hash
  columns, and the shape of a raw key. Where the model has a field with a read rule, every successful answer of
  every walk is also held to it as it arrives, before the walk goes on: for each row in the answer, and each row
  an include or a relation through a junction put under it, the harness reads the row and the caller's
  memberships from the database, predicts with its own evaluator whether the rule allows that caller on that row,
  and wants the key in the row exactly then. A key that is there for a caller the rule refuses is a leak; one
  missing for a caller it allows is a presenter that withholds too much. This runs through the tenant walk's
  second pass too, where the rule checks are off and the field rules are not. At the end each actor's `fields`
  answer is compared with what the rules say of their session. The detail counts the fields predicted, present
  and absent. A sealed field is held to its value as well: what an allowed caller is answered must be what the
  column holds once the harness opens it with the format's reference and the run's key. For every sealed column
  a resource lets a caller write, each signed-in caller writes one on a row of their own: the stored bytes must
  not contain the value and must open, by the reference, to exactly what was written; the harness then stores
  bytes it sealed itself and every caller reads the row; then it stores a value sealed for another column, one
  sealed under another key and bytes that were never sealed, and a caller the rule allows must get 500 each
  time, never a value and never an absent key, while every other caller's answer stays what it was. Nothing
  written may be in any answer under another key, or in the app's log.
- **fuzz**: from the IR, wrong types, boundary lengths, extra keys, missing and null required fields, server-owned
  fields, malformed and missing ids and bad list parameters, as every caller; only 400, 401, 403, 404, 409 and 410
  may answer, never a 5xx, a timeout or a 2xx on an invalid input. A money field is also sent as a JSON number,
  with five fraction digits, with sixteen digits before the point, with an exponent, a separator and a currency
  sign, and one step outside each bound it declares. A json field with a shape gets, for every key at every
  depth, a wrong type, null, the key left out when it is required, an unknown key beside it, an array and a string
  where the object belongs, and for a shape per enum value the shape of another value and the enum changed
  without the value; each is sent only if core's reference validator refuses it, and a 400 must name the key
  (`config.url`). It also stores, straight into the database, a value that misses its shape, as a row written
  before the shape would hold, and reads the row: the answer is 200 with the stored value as it is. The seed is
  `walks: { seed }` in `fixture.yaml` (or `--seed`), so a failure replays.
- **contract**: between every two consecutive revisions of the fixture's lock, the breaking changes of the OpenAPI
  document (`diffOpenApi` in core: removed paths, operations, parameters, schemas and properties, narrowed types,
  new required fields, a response property that may now be absent) must each be explained by an op of that revision's diff (`explainedBy`); one no op explains
  is a compiler regression. Migration steps that rewrite a table (`MigrationPlan.rewrites`) are listed in the
  detail.
- **invite**: with `auth.invites`, what a scenario cannot reach, per invited membership. A token nobody issued is a
  404 on the lookup and on the accept. The first actor the invite's rule allows invites an account the walk
  registers: the lookup answers the parent, the address masked and `account: true`; the inviter's own accept is a
  403 and the invite still waits; the invitee's password login without the token joins nothing; the invitee's
  accept is a 200 that names the parent, the membership row is in the database and the invite is gone; a second
  accept and a second lookup are 404. A second invite is aged through the database handle, since no scenario can
  wait a week, and answers 410 to the lookup and to the accept, with and without a session. A model without
  invites has nothing to walk and says so.

The five earlier walks learned the construct as well. The rule and fuzz walks send an invite's create with the
lowest role of its membership, so the rule decides the answer and the role ceiling never does. The fuzz walk
sends the two token routes strings no invite was issued under, as every caller, and takes only a 404. The leak
walk fails a read of an invite that carries a token and a lookup whose address is not masked. The contract walk
counts a change to the auth block, the membership or its parent as what explains a change to an invite's entity
or resource. The invite walk runs before the rule walk's deletes and before the leak walk, so the rows it names
are still there and its replies are scanned too.

The eval runner's full runs inherit the walks through the harness, so a proposal that generates fine but breaks a
rule somewhere fails its case. The harness's own client speaks each transport (REST, tRPC) the way the generated
test clients do, in `packages/conformance/src/client.ts`.
