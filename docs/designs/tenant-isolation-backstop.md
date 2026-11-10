# Design: the tenant isolation backstop

**Status: proposed 2026-11-09.** Not yet built. The grammar below is the design to review before the build. Since
2026-11-10 it is round B1 of the road to 1.0.0 (`docs/roadmap.md`), the first round of milestone B and no longer
the last construct round, with two questions to settle first, listed under Proof.

The rounds name gaps by what agents could not express. This note comes from the other direction: what two
production applications of the shape OSL generates (a SaaS over Postgres with teams, roles, an API, a worker and a
web app) had to build by hand and then police with lint rules, structural tests and migrations, because nothing
generated it for them. Tenant isolation is the clearest case. Both applications started with filters in the
handlers, the way OSL's `member:` rules work today, and both later added a fail-closed row-level security policy on
every tenant table as a backstop, a second database role without the right to bypass it, composite foreign keys so
that a key check cannot read past the policy, and a generator for the policies, because by then there were hundreds
of tables. Retrofitting cost each of them two large online migrations and a hand-kept map of which table reaches the
tenant through which parent. OSL knows the relations, so it can emit all of it from the first migration.

## What hand-written applications do

| Pattern                                                                                      | By hand                                                                     | Verdict                                        |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| A policy `tenant_id = current_setting('app.tenant_id')` on every tenant table, fail closed   | a generator script, a coverage test, an exclusions file with justifications | construct: `isolation: database`               |
| Tables without a tenant column reach it through a chain of parents in the policy             | a hand-maintained map of ancestors, read by the generator                   | derived: every tenant table carries the column |
| Composite foreign keys `(tenant_id, parent_id) → parent(tenant_id, id)`                      | a helper used on every relation, a test that fails on a missing twin        | construct, derived from relations              |
| The app connects as a role that cannot bypass the policy; migrations run as the owner        | two connection strings, a boot check that refuses the owner in production   | construct                                      |
| Nothing unbound runs: a statement with no tenant set returns no rows, and strict mode throws | a wrapper around the pool                                                   | the mapping                                    |
| No external I/O inside the tenant transaction                                                | a sentence in the conventions, policed in review                            | a reference sentence for `osl implement`       |
| A walk that calls every id-taking operation as another tenant's owner and expects nothing    | a structural test every app must run                                        | the proof (see `conformance-walks.md`)         |
| Substring search under the policy cannot use its index                                       | search functions with elevated rights                                       | declined for now; noted                        |

## The construct

```yaml
auth:
  tenancy:
    entity: Team
    membership: TeamMember
    role_field: role
    creator_role: owner
    isolation: database # none (the default, and today's behaviour) | database
```

With `isolation: database`, the database refuses what the rules would refuse, independently of the generated
handlers. The rules stay the primary check and keep their statuses; the policy is the backstop that turns a
forgotten filter into zero rows instead of a leak.

- **Tenant tables.** An entity is a tenant table when it is the tenant entity, the membership, or reaches the tenant
  through a chain of required `many_to_one` relations (Task → project_id → Project → team_id → Team). Every tenant
  table carries the tenant relation itself: where the model declares it (Project.team_id) it is that field; where the
  chain is indirect (Task) the compiler adds a derived field, `team_id` by the tenant entity's name, not in the
  model file and not accepted from or returned by the API, set on create from the related row and kept equal to it
  by a composite foreign key `(team_id, project_id) → projects(team_id, id)`. The parent gains `UNIQUE (team_id,
id)`. One policy shape for every table, and no row can point at another tenant's parent.
- **Everything else is shared.** The identity entity, lookup entities with no chain to the tenant, and junction
  tables between shared entities get no policy. An entity with two different chains to the tenant must declare the
  tenant relation itself (diagnostic). An entity that reaches the tenant only through an optional relation is shared
  (diagnostic, a warning: say `required: true` to make it a tenant table).
- **The policy.** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `FORCE`, one policy per tenant table for all
  commands: `team_id = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[])`. No setting, no rows. The
  setting carries every team the session is a member of, so a user in several teams keeps today's semantics (lists
  show rows of all their teams), and the grammar does not gain a "current team".
- **Two roles.** The migrations create `<app>_app` (login, no `BYPASSRLS`) and grant it the tables and sequences;
  `DATABASE_URL` is the owner the migrator and the worker use, `DATABASE_APP_URL` is what the web process uses, and
  the generated README says so. The worker runs schedules and timers as the system, which is what the owner role
  means.
- **Session-free alternatives are refused.** A rule on a tenant table with an alternative that needs no session
  (`public`, with or without a condition) cannot be expressed by the policy without compiling the condition into it.
  Under `isolation: database` such a rule is an error (diagnostic) in this version; the compiled-alternative
  extension is declined below with the sentence the reference gets.

## Mapping

- Core: `Tenancy.isolation?: "none" | "database"`. The IR gains `EntityIR.tenant: { field, derived }` for tenant
  tables and `ir.tenancy.app_role`. `planMigration` emits, for a tenant table, the derived column (with a backfill
  from the parent when the table exists, in batches of 10,000 by primary key, then `SET NOT NULL`), the parent's
  unique index, the composite foreign key, `ENABLE` and `FORCE ROW LEVEL SECURITY`, the policy, and the role and
  grants once per database; renames rename the policy. Turning isolation off drops them in reverse. Drift compares
  policies too.
- drizzle-next and hono-trpc-vite: the request handler opens a transaction, runs
  `SELECT set_config('app.team_ids', $1, true)` with the session's memberships (or `''` for an anonymous caller)
  and hands the transaction to the resource module as `db`; `withRuleValues`, the list filters and the handlers do
  not change. The web process connects with `DATABASE_APP_URL`. Action handlers receive the same transaction.
- gin-pgx: `pool.BeginTx`, `set_config`, the handler, commit; the same two connection strings.
- The job runner (queued events, schedules, timers) keeps the owner pool: a timer acts on one row whose team is
  known, a schedule acts for every team, and both are system work.
- Reference: under tenancy, two sentences: what `isolation: database` adds and that every tenant table must reach
  the tenant through required relations. For `osl implement`: "do outbound calls after the write, not inside the
  transaction the handler was given".
- `docs/backends.md`: the tenancy row names the policy, the roles and the composite keys.

## Declined, with the sentence the reference gets

- Compiling session-free alternatives into the policy (`published = true OR team_id = ANY(...)`): deterministic for
  plain row conditions and for paths as `EXISTS` subqueries, since lists already compile them, but it doubles the
  policy shapes and the proof. Logged as the next step; the reference says "a public alternative on a tenant table
  needs `isolation: none`".
- A "current team" per request (a team switch): the memberships array keeps today's semantics; a team switch is a
  product decision the model does not make.
- Search functions with elevated rights so that substring search can use a trigram index under the policy: OSL
  creates no trigram index today, so search is correct and no slower than it is; noted for when it does.
- Per-tenant connection limits and pools: operations, not the model.

## Proof

- Fixture: workspace, the one with tenancy, gains `isolation: database` through a new intent (WS-9) that changes
  nothing else; every existing scenario must pass unchanged on all three backends, which proves the statuses did
  not move. The snapshot shows the policies, the roles and the derived `team_id` on Task and Milestone.
- The cross-tenant walk (`conformance-walks.md`): for every resource over a tenant table and every id-taking
  operation, a member of another team gets 404 or 403 and the row is unchanged, and their lists hold nothing from
  the first team. This exists before the backstop and passes through the rules; the backstop is proven by a second
  pass the harness runs with the generated rule checks disabled through a test hook (`OSL_TEST_HOOKS=1` only):
  every operation then still returns nothing from the other team, because the policy did it.
- A leak probe under the hooks: `GET /api/osl-hooks/tenancy/unbound` runs `SELECT count(*)` on every tenant
  table as the app role without the setting and must answer zero for each.
- Eval cases: the tenancy asks the rounds already have, graded again with `--resume` losing nothing; one new case
  whose ask says "no team may ever see another team's data, enforced in the database".

To settle before the build, from the review of 2026-11-10 that moved this round to the start of milestone B:

- The workspace fixture cannot turn isolation on as it stands. WS-7 gives Task
  `read: "public when project_id.public = true or owner:assignee_id or member:project_id.team_id:admin"`, a
  session-free alternative on a tenant table, which this note refuses. Either the compiled alternative declined
  above joins the round, or the proof moves to a model without one.
- The same rule's `owner:assignee_id` admits a caller by a field of the row and not by their teams. Whether an
  owner who is not a member of the row's team still reads the row under a policy keyed on the caller's teams, and
  with which status when not, is not said above.

The intent the first bullet of this section names, WS-9, was taken by round A2 (channels); the round takes the
next free one.

## Size

Core: the tenancy key, the derived field in the IR, the migration steps (column, backfill, unique, composite key,
policy, role, grants), drift, two diagnostics, the reference. One request wrapper per backend and the second
connection string in the environment, README and Docker files. The walk's second pass and the probe in the harness.
About the size of the scheduling round, mostly in migrations and the harness.
