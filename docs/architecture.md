# OSL 1.0 architecture

OSL is a compiler. It turns a declared application model into working code for a chosen stack and keeps language-model work at two edges: proposing a change and filling custom logic. Everything between those edges is deterministic.

```
intent.yaml  ──propose──▶  diff.yaml  ──apply──▶  model.yaml ──compile──▶  IR ──backend──▶  files
 (prose +                 (reviewed               (declared state,         (resolved,        (schema, migrations,
  acceptance)              typed ops)              machine-written)         neutral)          handlers, auth, tests)
```

## The pieces

| Piece       | Package            | What it owns                                                                                                                                                                |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model       | `@osl/core`        | The declared state in `.osl/model.yaml`: entities, fields, relations, rules, resources, auth, events, examples. Written only by `osl apply`.                                |
| Diff        | `@osl/core`        | Typed operations that change the model. The reviewable artifact of an intent. `applyDiff` is a pure function.                                                               |
| IR          | `@osl/core`        | The compiled model with every default made explicit: table and column names, foreign keys, indexes, resolved rules, routes, writable and output fields, resolved scenarios. |
| Lock        | `@osl/core`        | `.osl/model.lock.json`: the model hash, and every applied revision with its diff hash, renames and IR. Migrations are derived from consecutive revisions.                   |
| Migrations  | `@osl/core`        | `planMigration(prev, next, renames)` diffs two IRs into DDL steps; `renderPostgres` writes SQL; `runMigrations` applies files with a checksum ledger.                       |
| Drift       | `@osl/core`        | Compares a live database with the IR.                                                                                                                                       |
| Backend     | `@osl/backend-*`   | A pure function from IR plus history to files, and the commands to install, check, serve and test what it generated.                                                        |
| Conformance | `@osl/conformance` | Builds a fixture, snapshots the output, installs, checks, migrates a throwaway database, starts the app and runs the contract tests.                                        |
| CLI and MCP | `@osl/cli`         | `osl` commands and an MCP server over stdio for agents.                                                                                                                     |

## Guarantees

- **Determinism.** The same model history and backend version produce byte-identical files. Two generations of a fixture are compared in the test suite, and the conformance snapshot is the committed proof.
- **One source of truth.** `model.yaml` is machine-written and hashed into the lock. A hand edit is detected on the next command. Intents are idempotent: applying one twice is a no-op, and a changed diff for an applied intent is refused.
- **Ownership.** Files are `generated` (rewritten every time, removed when no longer produced), `scaffold` (written once) or `regions` (only marked blocks are rewritten). Custom code lives in `src/` and survives regeneration.
- **Renames stay renames.** `rename_entity` and `rename_field` are recorded per revision and the migration emits `RENAME`, never drop and create.
- **Verified by running.** Example scenarios in the model compile to contract tests. The conformance harness runs them against a real server and a real PostgreSQL database.

## Where the LLM sits

| Step                                      | Who                                  | Why                                                                                                                                  |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Write an intent                           | Human                                | The ask in prose plus acceptance criteria.                                                                                           |
| Propose a diff                            | Claude, via `osl propose`            | Turns prose into typed ops. Validated locally and retried once with the validation errors. The human reviews the diff, not the code. |
| Apply, compile, generate, migrate, verify | Deterministic code                   | No model calls.                                                                                                                      |
| Custom logic                              | Claude, via `osl implement`, or a human | Action handlers in `src/actions`, written from the action's declaration, the scenarios that call it and the generated files, checked by the backend's compiler and retried with its output. Hooks and event handlers stay yours. |

A backend itself can be written by a model once, against the conformance suite, and then frozen. The suite is the gate, not a review.

## The boundary rule

A construct enters the model only when at least two backends can generate it deterministically. Anything with a single-stack mapping, or no deterministic mapping, stays in prose and is handled in `src/`.

## Project layout

```
.osl/
  config.yaml           backend and generated_dir, policies
  model.yaml            declared state (machine-written)
  model.lock.json       hashes and the revision history with IR
  generated.json        the generated files OSL owns
  intents/<ID>/
    intent.yaml         the ask
    diff.yaml           the reviewed ops
generated/              backend output, never edited by hand
src/                    extension points: hooks and event handlers
```

## What 1.1 added

Five constructs, each with a deterministic mapping in the TypeScript backends and the Go backend: actions
(operations beyond CRUD, with the handler left to you), file fields with a two-step upload flow and a storage adapter,
tenancy (memberships with ranked roles and `member:` rules) plus magic-link and OAuth providers behind an email
adapter, page layouts (split, table, board, dashboard) rendered by both web stacks from one generator, and tooling
(queued events on a Postgres-backed worker, an OpenAPI document from the IR, Docker files, seed steps). The boundary
rule held: user logic stays in `src/` (action handlers, event handlers, hooks), and every generated piece is proven by
the fixtures through the conformance harness, which can overlay a fixture's user code per backend.
