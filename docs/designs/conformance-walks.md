# Design: conformance walks

**Status: built 2026-11-09** (round A1 of the road to 1.0.0). What changed from the design below while building:
the contract diff compares consecutive revisions of the fixture's lock rather than the committed snapshot, since
the snapshot step already proves the committed document byte for byte and the lock holds every revision's IR; the
leak walk scans the walks' own responses (the scenarios' bodies are asserted by the generated clients, which
already refuse hidden columns); the two hooks for the second tenant pass wait for the isolation round (B1); the
rule walk makes one row per actor the create rule allows and retries an allowed create that conflicts (a
membership the creator already holds) with another actor as the related user, and its detail counts what the
predictions said (on workspace: 317 calls, 152 allowed, 78 as 403, 76 as 401, 9 as 404) so the coverage is
visible. The harness got its own transport clients (REST and tRPC) in `packages/conformance/src/client.ts`, a rule
evaluator that resolves path values and memberships from the database in `rules.ts`, a seeded body generator in
`bodies.ts`, and the walks in `walks.ts`; core got `diffOpenApi`, `explainedBy` and `MigrationPlan.rewrites`.
Proof: all three fixtures on all three backends pass the five walks with no change to the fixtures (blog 351 rule
calls and 600 fuzz probes per backend, workspace 317 and 676 with ten home-team rows checked against an outsider,
todo 15 and 79), the blog's eleven revisions show one breaking change (the Post to Article rename) explained by
its op, and the oracle eval corpus runs through the walks. The first run's only findings were the harness's own:
an update probe that left a required field out, which a partial body may, and the conflicting membership above.
Not a construct: five checks the harness runs over every fixture and every backend without a scenario naming
them; nothing here changes the grammar. Since 2026-11-10 (round B1, `tenant-isolation-backstop.md`) the tenant
walk has its second pass and the two hooks: on a fixture with `isolation: database` it runs again with the
generated rule checks switched off, after a control that shows the switch worked, and then asks what the app's
database role reads with no tenant bound; a row the read rule opens to everyone is accounted for in both passes.
Since round B3 (`archive-and-counts.md`) the rule walk predicts what an archiving entity's list leaves out and what
`archive` and `restore` answer (the 409 when there is nothing to do included), and the rule and order walks end by
comparing every count of the model with the rows the database holds.

Since round B4 (`state-machines.md`) the rule walk predicts a transition from the row's state: after the rule, 200
when the state is one the transition starts from and 409 when it is not, and it reads the row afterwards (the field
at the transition's `to` with its stamp set, or where it was). The tenant walk needed nothing: it already calls
every row action as the outsider and takes nothing but 401, 403 or 404, so a 409 from another tenant's row would be
a finding. No walk drives a page: the board's drag was checked once with a browser outside the repository.

Scenarios prove what a fixture's author thought to write. The hand-written applications surveyed for these notes
learned that the properties worth proving are the ones nobody writes a test for per entity: every procedure records
a permission or is on a reviewed open list; every id-taking procedure called by another tenant's owner returns or
changes nothing; every mutation under an audited router declares its audit; every route is classified for auth;
the committed OpenAPI document equals the routes; a baseline of lint findings may only shrink. They run those as
structural tests every app must include. OSL can run them as a pure function of the IR, for every backend, and
fail the build rather than the review.

## The walks

1. **The rule walk.** For every resource operation, action and transition, and for every actor of the fixture plus
   an anonymous caller, the harness computes what the IR's rule predicts (200-class, 401, 403, 404 under `hidden`)
   against a row the owner created, calls it, and compares. A mismatch is a backend bug, found without a scenario.
   Rows for the walk come from the fixture's seed and from the first create each actor may run; an entity no actor
   may create is walked with its reads only.
2. **The cross-tenant walk.** With tenancy: every id-taking operation on a tenant table, called by a member of
   another team with an id from the first, answers 404 or 403 and leaves the row unchanged; every list as that
   member holds nothing from the first team; every create naming the first team's parent is refused. With
   `isolation: database` (`tenant-isolation-backstop.md`) the walk runs a second pass with the generated rule
   checks disabled through a test hook, and must still pass.
3. **The leak walk.** Every response body the whole run produced (scenarios and walks) is scanned for the names of
   hidden fields, sealed fields, `read`-ruled fields outside their rule, `password_hash`, `key_hash`, `token_hash`
   and the pattern of a raw key. One hit fails the fixture. This is what makes `hidden`, `sealed` and `read` a
   contract rather than a convention.
4. **The fuzz walk.** From the OpenAPI document, for every operation, a seeded generator sends bodies and
   parameters of the wrong shape, the wrong type, extra keys, boundary lengths and bad ids, as every actor, and
   accepts only 400, 401, 403, 404, 409 and 410. A 500, a hang past the deadline, or a 2xx on an invalid body
   fails. The seed is in the fixture so a failure replays.
5. **The contract diff.** The harness compares the fixture's OpenAPI document with the committed snapshot and names
   every removed path, removed property, narrowed type and added required field. Each must be explained by a diff
   op in the lock's history since the snapshot (`remove_field`, `rename_entity`, `update_resource` ...); one that
   no op explains is a compiler regression and fails. A migration plan that rewrites a table (a type change, a
   `NOT NULL` without a default) is listed in the same report, so a review sees it.

## Mapping

- `packages/conformance`: a `walks.ts` beside the scenario runner, each walk a function of the IR, the running
  app's base URL and the actor sessions; results join `FixtureResult.steps` with a `walk:` prefix so the summary
  and the exit code treat them as steps. `--walks` runs them alone; `--no-walks` skips them for a quick scenario
  pass. The hooks the walks need (`/api/osl-hooks/rules/off` for the second tenant pass, `/api/osl-hooks/tenancy/
unbound`) exist only under `OSL_TEST_HOOKS=1`.
- Core: `openapi.ts` gains a `diffOpenApi(before, after)` returning the breaking changes, and the lock exposes the
  ops since a given model hash for the explanation step; `planMigration` marks rewrite steps.
- The eval runner's full runs inherit the walks through the harness, so a proposal that generates fine but breaks
  a rule somewhere fails the case.
- Reference: nothing; the walks are the harness's.

## Declined

- Property-based generation of whole scenarios: the fuzz walk covers shapes; semantics stay with scenarios.
- A performance walk (latency budgets per operation): numbers depend on the machine; a later note. Since
  2026-11-10 an open quality entry in `docs/roadmap.md`.
- Running the walks against a user's project through `osl verify`: desirable, and the same code; after the harness
  proves them on the fixtures. Round A1 did, and since 2026-11-10 this is quality round Q3 in `docs/roadmap.md`.

## Proof

- Every fixture on every backend passes all five walks with no change to the fixtures, or the walk found a bug, in
  which case the bug is fixed first and the walk is the regression test. The expectation is a handful of real
  findings on the first run, most likely in the fuzz walk.
- The contract diff is proven by a deliberate regression in a test: a backend that drops a route must fail.

## Size

The harness only: five functions, two hooks, the OpenAPI diff and the lock query in core, flags and docs. Smaller
than any construct round, and it raises what every later round proves.
