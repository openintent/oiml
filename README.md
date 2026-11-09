# OSL - Open Schema Language

OSL compiles a declared application model into working code. You describe entities, relations, access rules, API resources, auth, events and example scenarios once. OSL turns that into a database schema, migrations, route handlers, validation, sessions and contract tests for a chosen stack, deterministically. A language model is used in exactly two places: `osl propose` turns prose into a model change, and `osl implement` writes the action handlers, the custom logic no schema can express. Both are checked by the compiler and measured by the eval suite.

```
intent.yaml  ──propose──▶  diff.yaml  ──apply──▶  model.yaml ──compile──▶  IR ──backend──▶  schema, migrations,
 (prose +                 (reviewed               (declared state,         (resolved,       handlers, auth, tests
  acceptance)              typed ops)              machine-written)         neutral)
```

## Why

Code generation by an LLM is fast to start and slow to trust. The same prompt yields different code, nothing checks that the result matches the request, and the project's real schema lives only in framework files. OSL inverts that:

- **The model is the state.** One machine-written file declares what the application has. Intents change it; nothing else does. A hand edit is detected.
- **Deterministic from there on.** The same model history and backend version produce byte-identical files. Migrations are a pure function of the history, and renames stay renames.
- **Proved by running.** The scenarios in the model become contract tests. The conformance harness runs every backend against every fixture on a real database before it ships.
- **Stack-neutral in the middle.** The IR is the contract. A backend is a pure function from IR to files, plus the commands to run what it generated.

## Quick start

```bash
pnpm install && pnpm build
alias osl="node $PWD/packages/cli/dist/cli.js"

mkdir ~/blog && cd ~/blog
osl init --name blog                       # .osl/ with an empty model
osl intent FEAT-1 --title "User accounts" \
  --ask "People register with an email and password and sign in. Each user has a name." \
  -c "Registering twice with the same email fails with a conflict"
osl propose FEAT-1                         # Claude writes .osl/intents/FEAT-1/diff.yaml; or write it by hand
osl apply                                  # folds the diff into model.yaml and the lock
osl generate                               # Drizzle schema, migrations, Next.js routes, auth, tests
pnpm install
osl implement                              # Claude writes the action handlers the model declares, if any; checked with tsc
echo 'DATABASE_URL=postgres://postgres@localhost:5432/blog' > .env
osl migrate
pnpm dev &
osl verify --base-url http://localhost:3000   # generated files current, typecheck, migrations, drift, contract tests
```

`osl propose` needs Claude API credentials. Without them, write `diff.yaml` by hand; the format is in [docs/model.md](docs/model.md) and the fixtures under `fixtures/*/intents` are complete examples.

## What a model covers

| Area                | In the model                                                                                                                                                                                              | What the backend makes of it                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------- |
| Entities and fields | 15 field types, defaults, uniqueness, validation, hidden fields, composite keys                                                                                                                           | Tables, enums, columns, constraints, row types                                                                                   |
| Relations           | Foreign keys with reverse names and delete behavior, one-to-one, junction tables                                                                                                                          | Constraints, indexes, relational queries                                                                                         |
| Rules               | `public`, `authenticated`, `owner:<field>`, `role:<value>` per operation; alternatives with `or`; paths through relations (`owner:article_id.author_id`); row conditions (`public when published = true`) | Checks in every handler; owner set from the session; lists filtered, through relations with subqueries and by the row conditions |
| Resources           | list, get, create, update, delete with filters, order, pagination, includes, writable fields                                                                                                              | Routes, validation, envelopes, error mapping                                                                                     |
| Auth                | Credentials on an identity entity                                                                                                                                                                         | Register, login, logout, me; signed cookie sessions; scrypt hashes                                                               |
| Events              | `Entity.created                                                                                                                                                                                           | updated                                                                                                                          | deleted` to a handler | Dispatch to user-owned handlers |
| Examples            | Actors and ordered scenarios with expected responses                                                                                                                                                      | Contract tests                                                                                                                   |
| Actions             | Operations beyond CRUD on a resource or globally, with input, rule and result shape                                                                                                                       | Routes or procedures, validation, typed handler stubs, filled in by you or `osl implement`                                       |
| Files               | `file` fields with accepted types and size limits                                                                                                                                                         | Upload flow, local or S3-compatible storage, snapshots, signed URLs                                                              |
| Tenancy             | Teams with memberships and ranked roles; `member:<field>[:<role>]` rules                                                                                                                                  | Membership-scoped lists and checks, auto-membership for creators                                                                 |
| Providers           | Credentials, magic links, OAuth (GitHub, Google, OIDC)                                                                                                                                                    | Token and state tables, email adapter, sign-in routes                                                                            |
| App                 | Pages over resources (split, table, board), dashboards, custom pages, a sidebar with a footer                                                                                                             | Sidebar shell, routes and pages (`hono-trpc-vite`, `drizzle-next`)                                                               |
| Tooling             | Queued events, seed steps                                                                                                                                                                                 | pg-boss or River worker, OpenAPI document, Docker files, `osl seed`                                                              |

## Repository

| Path                    | What                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core`         | Model, diff, IR, lock, migrations, migrator, drift, the backend contract, the project layer                                                      |
| `packages/ts-common`    | Generators shared by the TypeScript backends: Drizzle schema, validation, presenters, events, test matchers, shadcn/ui                           |
| `packages/backend-ts`   | `drizzle-next`: Drizzle ORM, Next.js route handlers, Zod, Vitest                                                                                 |
| `packages/backend-vite` | `hono-trpc-vite`: Hono + tRPC API, Vite + React + TanStack Router web app with a sidebar shell and master/detail pages                           |
| `packages/backend-go`   | `gin-pgx`: Gin, pgx, `go test`                                                                                                                   |
| `packages/conformance`  | The harness that proves a backend against the fixtures                                                                                           |
| `packages/cli`          | `osl` commands, `osl propose` (Claude) and `osl mcp` (stdio MCP server)                                                                          |
| `packages/evals`        | The agent evals: runs `osl propose` over the corpus in `evals/propose/cases` and scores the diffs                                                |
| `fixtures/`             | Fixture intents and the committed snapshots each backend must reproduce                                                                          |
| `docs/`                 | [architecture](docs/architecture.md), [model and diffs](docs/model.md), [backends](docs/backends.md), [cli](docs/cli.md), [evals](docs/evals.md) |
| `legacy/`               | OSL 0.1 (the intent log, prose packs, Studio, VS Code extension), kept for reference                                                             |

## Development

```bash
pnpm build          # all packages
pnpm test           # unit tests: core, backends, cli
OSL_TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm conformance   # full proof on a real database
pnpm conformance --snapshot-only                                                     # generate and compare only
pnpm evals --no-full                                                                 # agent evals: osl propose over the corpus (needs ANTHROPIC_API_KEY)
```

Node 22+ and pnpm 10. The conformance run needs PostgreSQL for a throwaway database per fixture, and Go 1.26 for the `gin-pgx` backend. Pick a backend at `osl init --backend drizzle-next | hono-trpc-vite | gin-pgx`, and for the TypeScript ones the package manager of the generated project at `--package-manager pnpm | bun | npm`.

## Status

OSL 1.1 is an alpha. All three backends pass all three fixtures end to end on a real database, and the conformance snapshots are committed as proof. See the plan in the docs for the boundary rule and what is deliberately out of scope: generated handlers beyond the five standard operations, pages beyond master/detail over a resource, and any construct without a deterministic mapping.

## License

Apache 2.0.
