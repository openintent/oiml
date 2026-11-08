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
    serve(port: number): Cmd; // DATABASE_URL, OSL_SESSION_SECRET and PORT are set
    test(baseUrl: string): Cmd; // contract tests against a running app
    readyPath: string; // answers once the server is up
    migrationsDir(generatedDir: string): string;
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

| Area           | Requirement                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema         | Tables, columns, enums, foreign keys, indexes and unique constraints exactly as the IR states.                                              |
| Routes         | One route per operation in each resource, skipping operations whose rule is `none`.                                                         |
| Envelopes      | List `{ data, page: { page, page_size, total } }`; get, create (201), update `{ data }`; delete 204. Errors `{ error: { code, message } }`. |
| Status codes   | 400 validation, 401 unauthenticated, 403 forbidden, 404 not found (a malformed id is not found), 409 conflict.                              |
| Validation     | From the IR columns: types, lengths, formats, patterns, ranges, enums. Unknown body keys are rejected.                                      |
| Rules          | `public`, `authenticated`, `owner:<field>` (set from the session on create; filtered on list; 403 on mismatch), `role:<value>`; alternatives joined with `or`; owner and member paths through relations (`owner:article_id.author_id`), resolved before the check and as subqueries on lists. |
| Auth           | Register, login, logout, me; cookie sessions signed with `OSL_SESSION_SECRET`; scrypt password hashes; the password column is hidden.       |
| Hidden columns | Never serialized, not even inside included relations, and never accepted from a client.                                                     |
| Events         | Handlers in user-owned files, called after create, update and delete.                                                                       |
| Hooks          | User-owned before and after hooks around each resource's handlers.                                                                          |
| Tests          | Contract tests compiled from the model's scenarios, run against `OSL_BASE_URL`.                                                             |

## Conformance

```bash
OSL_TEST_DATABASE_URL=postgres://user@host:5432/postgres pnpm conformance            # every fixture, every backend it lists
pnpm conformance blog --backend drizzle-next                                         # one fixture, one backend
pnpm conformance --snapshot-only                                                     # generate and compare only
pnpm conformance --update                                                            # rewrite snapshots after an intended change
```

For each fixture and backend the harness runs: generate, snapshot compare, install, check, create a throwaway database, migrate, drift check, start the server, run the contract tests, drop the database. The contract tests receive the same `DATABASE_URL` as the server: an actor that carries a `role` is registered through the API and then given it straight in the database, since register refuses it. A backend is accepted when every fixture passes. Snapshots live in `fixtures/<name>/expected/<backend>/` and are the committed proof of determinism.

The TypeScript projects are installed and run with pnpm unless `.osl/config.yaml` says `backend_options.package_manager: bun` or `npm` (`osl init --package-manager bun`). The option changes the install command, the generated `package.json` (the lifecycle-script allowance for esbuild, `pnpm.onlyBuiltDependencies` or bun's `trustedDependencies`) and the README's commands; the scripts themselves are the same, and `dev` is a small launcher (`scripts/dev.mjs`) that works under any of them. `pnpm conformance --package-manager bun` runs the harness with another manager as a spot check; it skips the snapshot compare, since the snapshots are written for pnpm.

## Available backends

| Name              | Stack                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Package                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `drizzle-next`    | TypeScript: Drizzle ORM, PostgreSQL via `pg`, Next.js route handlers, Zod validation, Vitest contract tests. Scaffolds Tailwind CSS 4 and shadcn/ui (config, theme, `cn` helper, the base components below) unless `backend_options.tailwind` or `backend_options.shadcn` is `false` in `.osl/config.yaml`; `npx shadcn add` works afterwards. `backend_options.appearance` is `system` (follows the OS, applied before first paint), `light` or `dark`. Ignores the model's `app` section.                                                       | `@osl/backend-drizzle-next`    |
| `hono-trpc-vite`  | TypeScript, one package with two processes: a Hono API hosting a tRPC router (`/trpc`, one router per resource plus `auth`) over Drizzle ORM and `pg`, and a Vite + React + TanStack Router web app typed by that router. Renders the model's `app` section: a shadcn/ui sidebar shell with the pages and a fixed footer (signed-in user with sign-out, settings), one master/detail page per resource page, scaffolds for custom pages, home, sign-in and settings. Tailwind and shadcn are always on; `backend_options.appearance` as above. | `@osl/backend-hono-trpc-vite` |
| `gin-pgx`         | Go: Gin, pgx, `go test` contract tests. Ignores the model's `app` section.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `@osl/backend-gin-pgx`         |

The two TypeScript backends share their generators through `@osl/ts-common` (`packages/ts-common`): the Drizzle schema and client, Zod validation, presenters, event dispatch, the contract-test matchers and the stock shadcn/ui sources. Each backend passes its own conventions (file headers, import aliases), so the shared code never guesses a layout. The shadcn files (components.json, theme, `cn`, the `use-mobile` hook and sixteen components: avatar, badge, button, card, checkbox, dropdown-menu, input, label, select, separator, sheet, sidebar, skeleton, table, textarea, tooltip) are captured verbatim from the shadcn CLI by `pnpm --filter @osl/ts-common sync:shadcn`; nothing in them is hand-edited.

The `hono-trpc-vite` contract tests speak tRPC's HTTP transport but assert the same scenarios: a successful call is the contract's 200 (201 and 204 fold into it), tRPC error codes carry the contract's statuses, and query-string filters are coerced to the typed input. Generated route files under `src/routes` are rewritten on every generate; the shell (`src/components/app-sidebar.tsx`, `app-shell.tsx`), the root route, home, sign-in and settings pages are scaffolds written once, and they read the sidebar's data from `generated/app/nav.ts`, so a later intent that adds a page needs no edits.

## What the 1.1 constructs become

| Construct | drizzle-next (REST) | hono-trpc-vite (tRPC) | gin-pgx (REST) |
| --- | --- | --- | --- |
| Actions | `POST <resource>/{id}/<name>`, `<resource>/<name>`, `/api/actions/<name>`; handler stubs in `src/actions/<handler>.ts` | procedures `posts.publish({ id, ...input })`, `actions.send_digest(input)`; same stubs | the same routes; stubs in Go |
| Files | `POST /api/files`, `PUT`/`GET /api/files/{id}/content`, `POST /api/files/{id}/complete`, `GET /api/files/{id}`; local disk or S3-compatible storage | `files.begin/complete/get` plus the REST content routes on the Hono app | the same routes |
| Member rules, tenancy | sessions carry memberships; lists filter by tenant; creators get a membership | the same | the same |
| Magic links, OAuth | `POST /api/auth/magic-link`, `/verify`, `GET /api/auth/oauth/<name>[/callback]`, `GET /api/auth/providers`; email through log, Resend or capture | procedures `auth.magic_link`, `auth.magic_link_verify`, `auth.providers`; OAuth as REST routes | the same routes |
| Queued events | pg-boss in the `pgboss` schema; the worker runs in the Next.js process from `instrumentation.ts` or alone with `tsx src/worker.ts`; `OSL_ROLE=web|worker|all` | pg-boss; `src/server/main.ts` starts it; `src/server/worker.ts` alone | River; `river_%` tables are left alone by drift |
| OpenAPI | `generated/openapi.json`, `GET /api/openapi.json` | not applicable (tRPC) | the same as REST |
| Seed | `tsx generated/seed.ts` replays `examples.seed` over HTTP; `osl seed` | the same over tRPC | a Go program |
| Docker | `Dockerfile`, `docker-compose.yml` with postgres and, with queued events, a worker service | the same | the same |
| App pages | `app/(app)/…` with the sidebar shell, React Query over the REST client | `src/routes/…` with TanStack Router over the tRPC client | none |

Every one of these is proven by the fixtures: `blog` (actions, files, search and sort, magic link and GitHub providers, table and dashboard pages, a queued event, seed), `todo` (actions, board and table pages, a dashboard, seed) and `workspace` (teams, memberships with ranked roles, member rules, auto-membership, magic link). A fixture may ship the user-owned code its scenarios depend on under `fixtures/<name>/overlay/<backend>/`; the harness copies it over the generated project before installing. Snapshots cover generated files only.

The generated `package.json` is a `merge` file: keys OSL adds later (a dependency a new feature needs, a script) land on the next generate, keys you changed or added are kept.

Environment the features read: `OSL_STORAGE` (`local` default, `s3` with `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` for R2, MinIO or Supabase, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`), `OSL_STORAGE_DIR`, `OSL_MAX_UPLOAD_BYTES`; `OSL_EMAIL` (`log`, `resend` with `RESEND_API_KEY` and `EMAIL_FROM`, `capture` for tests, where sign-in responses carry the token); `OSL_APP_URL` (where magic links and OAuth return); `OAUTH_<NAME>_CLIENT_ID` and `_CLIENT_SECRET`; `OSL_ROLE`. The harness runs with `OSL_EMAIL=capture` and local storage.

## Writing a backend

1. Copy the shape of `packages/backend-ts` or `packages/backend-vite`. Keep each generator a function from IR to a string; a TypeScript backend takes the shared generators from `@osl/ts-common`.
2. Produce the migration files with `migrationFiles` from core.
3. Mark user-owned files `scaffold` and env files `regions`.
4. Declare the runtime commands as a function of the project config (the TypeScript backends take the install command from `installCommand` in `@osl/ts-common`), including `seed` and, when other tooling owns tables, `ignoredTables`.
5. Register the backend in `packages/conformance/src/index.ts` and `packages/cli/src/backends.ts`, add it to each `fixtures/*/fixture.yaml`, and run the harness with `--update` to create its snapshots.
6. Keep iterating until every fixture passes every step. The harness output names the failing step and keeps the temp project with `--keep`.
