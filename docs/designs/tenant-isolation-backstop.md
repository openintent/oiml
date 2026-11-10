# Design: the tenant isolation backstop

**Status: built 2026-11-10** (round B1 of the road to 1.0.0). What changed from the design below while building:
the two questions were settled and a third the note had not seen (statuses), all listed under "Decisions settled
while building"; in short, a public alternative on the read rule of a tenant table is compiled into a second,
SELECT-only policy instead of being refused; every alternative that needs a session also needs a membership of the
row's tenant, which the compiler adds to the IR's rules; and another tenant's row keeps the rule's 403 or 401
through an existence probe. Row security is enabled and not forced; the derived column stays out of the entity's
columns and is kept by a trigger; the TypeScript backends bind in one transaction per request and the Go backend
per statement; the app role is created without a login and gets its password from the environment; the backfill is
one statement. The body below is the design as built. Proof: workspace WS-13 (the key and
one scenario of 27 steps), conformance 9/9 with every earlier scenario unchanged (workspace 192 scenario steps per
backend, 165 of them the earlier ones) and the five walks passing: 473 rule calls and 956 probes as before, 16
home-team rows checked against an outsider and again with the rule checks off, and the unbound probe reading 2 of
90 rows in 9 tenant tables, the 2 tasks of public projects. The fixture's database belongs to a role that is no
superuser. 136 unit tests, the oracle gate 28/28 with `fx-ws-13-isolation`, and the cases
`ws2-database-isolation` and `empty-clinic-isolation` for the next live round (both pass a full run with a diff
written by hand). Not a round the gap backlog asked for: it comes from the survey below.

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

## Decisions settled while building

Each was open in the proposal or not seen by it. Most consequential first.

1. **A public alternative on the read rule of a tenant table is compiled into the policy.** The proposal refused
   every alternative that needs no session and logged the compiled one as the next step; the proof fixture has one
   (WS-7, `public when project_id.public = true` on Task), so that step is in the round, for the read rule only. A
   tenant table whose read rule has public alternatives gets a second permissive policy, `<table>_public_read`,
   `FOR SELECT`, whose expression is those alternatives. A condition on the row's own column is inlined; a
   condition through a relation calls a function, `osl_read_<table>_<path>`, `SECURITY DEFINER` and owned by the
   role that migrates, because the parent's own policy must not decide whether the caller sees the value: a
   subquery in the policy would run under the parent's policy and show nothing to a caller who is not a member.
   The handlers call the same function where they resolve that path and where they filter a list, so the rule
   check, the list and the policy read one value. Reason: without it the fixture's public project cannot exist
   under isolation, and moving the proof to a model without one would have left the commonest mixed case unproven.
   A public alternative on create, update, delete or a row action of a tenant table is M126; so is `public` joined
   to a predicate that needs a session, where the status of a hidden row would depend on a value the handler
   cannot see.
2. **A signed-in caller reaches a tenant table's rows only as a member of the row's tenant, and the compiler says
   so in the rules.** `owner:assignee_id` on Task is compiled as `owner:assignee_id and member:project_id.team_id`:
   every alternative that needs a session and does not already ask for a membership of the row's tenant (any role)
   gets that predicate joined to it, in the IR. So the handlers, the list filters, the OpenAPI descriptions, the
   harness's evaluator and the reference all read the same rule, and nothing differs silently between what the
   rules say and what the database returns. M128 (a warning) names each rule the compiler changed, and `osl apply` prints it when the intent is applied. The tenant
   entity's own create rule is left alone: whoever creates a tenant becomes its first member. Rules of collection
   and global actions, which have no row, are left alone too; what their handlers read is still under the policy.
   Reason: the policy is keyed on the caller's tenants and cannot know an owner; an owner who is not a member would
   read through the rule and get nothing from the database, which is the silent difference the review named. The
   one observable change: an assignee, author or channel member who left the team no longer reaches the row
   (403). No earlier scenario exercised that, and WS-13's scenario states it.
3. **Statuses do not move: an existence probe tells another tenant's row from a missing one.** A handler loads the
   row through the policy, so another tenant's row does not come back. On a tenant table with `hidden: forbidden`
   the handler then asks `osl_exists_<table>(id)`, a `SECURITY DEFINER` function that answers a boolean; when the
   row exists the handler answers what the rule answers a caller it refuses (401 when the caller has no session
   and the rule wanted one, else 403), and 404 otherwise. With decision 2 that is exactly the rule's verdict on
   the row, so the harness's predictions and the handlers agree without the harness knowing about the probe. It
   reveals what a 403 already reveals. Under `hidden: not_found` there is no probe: both cases answer 404. The
   cost was one generated function per table and one branch per id-taking handler, so option (b) of the review,
   changing the scenarios, was not needed.
4. **Row security is enabled, not forced.** `FORCE` binds the table's owner unless it is a superuser, and the
   owner is the role that migrates, that the worker's jobs run as, that the three kinds of function above run as,
   and that referential actions (a cascade from a deleted team) run as. Forced, a deployment whose owner is not a
   superuser would lose all four. What dropping it costs: a web process that connects as the owner has no
   backstop. So the generated app refuses to serve when the role behind `DATABASE_APP_URL` is not bound
   (`row_security_active` is false for a tenant table: the owner, a superuser, `BYPASSRLS`), and the drift check
   reports a table someone forced. The harness proves it as deployed: the fixture's database belongs to a role
   that is no superuser, and the timer scenario runs under it.
5. **The derived tenant column is the table's, not the entity's, and a trigger keeps it.** It is in
   `EntityIR.tenant.derived`, never in `columns`, so no backend selects, inserts or presents it and a handler you
   wrote keeps working unchanged. A `BEFORE INSERT OR UPDATE OF <relation>` trigger, `SECURITY DEFINER`, copies it
   from the parent (a parent that does not exist raises the same foreign-key error as before), and the policy's
   `WITH CHECK` then judges the row by its real tenant. Reason: the proposal had the handler set it on create, and
   every hand-written insert (an action handler, a hook, a job) would have had to know a column the model does not
   show.
6. **Composite keys cover every relation between tenant tables, not only the chain.** Each relation from a tenant
   table to another tenant table (the tenant entity excepted) gets `(tenant, relation) → parent(tenant, key)`
   beside the plain key the model declares, and the parent `UNIQUE (tenant, key)`. The key the derived column
   comes through is `ON UPDATE CASCADE`, so a parent that changes tenant takes its rows along; an optional
   relation's key clears only the relation on delete (`ON DELETE SET NULL (<relation>)`, PostgreSQL 15). The
   plain key stays: adding is one online step, replacing is two.
7. **How a request is bound, per stack.** The TypeScript backends open one transaction per request (per procedure
   call under tRPC, so a batch does not share one) on the app role's pool, bind with `set_config(..., true)`, and
   `db` resolves to that transaction through `AsyncLocalStorage`; a list runs its page and its count one after the
   other; jobs queued in the request are sent once it commits. The Go backend keeps its statement-per-transaction
   semantics: a `*db.Scope` with the pool's method set sends each statement and its `set_config(..., true)` as
   one batch, which PostgreSQL runs as one transaction. Reason for the difference: Go handlers hold the pool by
   its type in a dozen signatures, some of them yours; a scope with the same methods changes a type name, a
   request transaction would have changed how every handler ends. Both are transaction-local, so nothing stays on
   a pooled connection and a pooler in transaction mode is safe. The proposal's "strict mode throws" for an
   unbound statement is not built: unbound, the app role reads no tenant row, and the unbound probe proves it.
8. **Memberships are read through a function.** A session's memberships are rows of a tenant table, read before
   any tenant is bound. `osl_memberships(user)`, `SECURITY DEFINER`, answers them; the request binds what it
   answers. A new tenant is bound before it exists: its create handler makes the uuid, adds it to the binding and
   then inserts the tenant and its creator's membership, which is why the tenant's key must be a uuid (M127).
9. **Credentials.** The migrations create the app role `NOLOGIN`, inside a block that tolerates the role existing
   (roles belong to the cluster, and two databases of one app may meet on it; an owner that may not create roles can be handed one made for it), and no password is in any generated file or snapshot. `osl migrate` reads `DATABASE_APP_URL` from the environment and makes its user a
   login with its password: the app role itself, or any other name as a member of the app role. Development: the
   `.env` holds the URL with a password of yours and `osl migrate` applies it. The harness: a login per run,
   `<database>_web`, with a random password kept in memory, made by the administrator connection as a member of
   the app role and dropped with the database. Docker: `docker-compose.yml` reads `OSL_APP_DB_PASSWORD` from the
   environment and fails with a sentence when it is unset.
10. **The backfill is one statement per table.** The proposal said batches of 10,000 by primary key; a migration
    file runs in one transaction, where batches shorten no lock. Tables are filled parents first. An online
    backfill for a large table is an operation outside the migration, and the plan lists the step as a rewrite.
11. **Drift compares the layer by what PostgreSQL stores.** Row security per table (and `FORCE`), each policy's
    command and expression, each function's body and `SECURITY DEFINER`, each trigger. PostgreSQL prints an
    expression back with its own parentheses and casts, so both sides are reduced to a canonical form before they
    are compared. Constraints, the composite keys among them, are still not compared, as for every other key.
12. **Diagnostics are M124 to M128**, in the tenancy family (M110 to M114). Built as M115 to M119; the invites round, built beside this one, took M115 to M118, and at the merge (2026-11-10) these moved to M124 to M128 in order: M124 two ways
    to the tenant, or the derived column's name taken; M125 (warning) only an optional relation reaches the
    tenant, the entity stays shared; M126 a public alternative where only the read rule may have one; M127 the
    identity under a tenant, or a tenant key that is not a uuid; M128 (warning) the rules the compiler narrowed.

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
  through required relations (Task → project_id → Project → team_id → Team). Every tenant table has a tenant
  column: the tenant entity's own key; where the model declares a required relation to the tenant (Project.team_id)
  that field; where the way is indirect (Task) a derived column, `team_id` by the tenant entity's name, on the table
  and not in the model, never accepted from or returned by the API, kept by a trigger and by a composite foreign
  key `(team_id, project_id) → projects(team_id, id)`. The parent gains `UNIQUE (team_id, id)`. One policy shape
  for every table, and no row can point at another tenant's parent.
- **Everything else is shared.** The identity, lookup entities with no way to the tenant, OSL's own tables (files,
  auth tokens) and the queue's get no policy. An entity with two required relations that reach the tenant must
  declare a required relation to the tenant itself (M124). An entity that reaches the tenant only through an
  optional relation is shared (M125, a warning: say `required: true` to make it a tenant table). The identity may
  not sit under a tenant (M127).
- **The policy.** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, and one policy per tenant table for all commands:
  `team_id = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[])`. No setting, no rows. The setting
  carries every team the session is a member of, so a user in several teams keeps today's semantics (lists show
  rows of all their teams), and the grammar does not gain a "current team".
- **Public rows.** The read rule's public alternatives become a second policy for SELECT only (decision 1). A
  public alternative anywhere else on a tenant table is M126.
- **Members only.** Every alternative that needs a session also needs a membership of the row's tenant; the
  compiler adds it and M128 says where (decision 2).
- **Two roles.** The migrations create `<app>_app` (no login, no `BYPASSRLS`) and grant it the tables.
  `DATABASE_URL` is the owner the migrator and the worker use, `DATABASE_APP_URL` is what requests use, and the
  generated README says so. The worker runs schedules and timers as the system, which is what the owner role
  means.

## Mapping

- Core: `Tenancy.isolation?: "none" | "database"`; `tenantLinks(model)` (shared by validation and the compiler)
  finds the tenant tables. The IR gains `EntityIR.tenant` (`column`, `derived`, `keys`, `unique`, `exists`),
  `auth.tenancy.isolation` (`appRole`, `setting`, `tenantType`, `memberships`) and `reader` on the condition of a
  public alternative's path; the rules of tenant tables are compiled with the tenant's membership. All of it is
  absent without the key, so the IR of every other model is what it was. `isolationObjects(ir)`
  (`packages/core/src/isolation.ts`) lists every object of the layer with its SQL; `planMigration` adds the
  derived column (nullable, a backfill from the parent, then `NOT NULL` when the table exists), the parent's
  unique, the composite keys, and creates or drops the layer's objects by comparing two revisions: what is gone
  or defined differently is dropped before anything is renamed, what is new or different is made after, and a
  policy is remade with a function it calls. Turning isolation off drops the layer, the keys and the column; the
  role stays, since it belongs to the cluster. `checkDrift` compares the layer. `provisionAppLogin` gives the app
  role its login, and `osl migrate` calls it.
- drizzle-next and hono-trpc-vite: `generated/db/client.ts` holds the owner's pool, the app role's pool and the
  scope (`withTenants`, `bindTenant`, `asSystem`, `afterCommit`, `rowExists`, the unbound probe). Every route
  (`withRequest`), procedure and REST route runs inside `withTenants`. Handlers are as they were except: a row
  that does not come back goes to `missing`, a list reads one statement at a time and skips its rule filter while
  the test hook has the rule checks off, a tenant's create binds the new id, a public alternative's path is read
  through its function, and a write the policy refuses (SQLSTATE 42501) is the rules' 403.
- gin-pgx: `generated/db/db.go` gains `Scope`, `ConnectApp`, `System`, `WithBinding`, `Bind`, `BindTenant`,
  `NewID`, `Exists` and `Unbound`; handlers, `auth`, `files` and `actions.Context` hold a `*db.Scope` where they
  held the pool; `app.New` opens the app role's pool and refuses a role the policies do not bind; the same
  handler changes as above.
- The job runner (queued events, schedules, timers) keeps the owner's pool: a timer acts on one row whose team is
  known, a schedule acts for every team, and both are system work.
- Reference: one paragraph under auth: what `isolation: database` adds, which entities are tenant tables, never
  to add the tenant column by hand, what the compiler does to the rules, where a public alternative may stand, and
  for `osl implement`: "do outbound calls after the write, not in the middle of the transaction the handler was
  given".
- `docs/backends.md`: a row in the mapping table and a section on the layer.

## Under `isolation: database`

From this round on a design note says what its tables, triggers and queries are under the policy. This one's:

| Thing                                         | Under the policy                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tenant entity, the membership             | tenant tables: `<table>_tenant` on the tenant's own key and on the membership's relation to it                                                                          |
| Entities reaching the tenant, required        | tenant tables, with a declared or a derived tenant column                                                                                                               |
| The identity, lookups, OSL's files and tokens | shared: granted to the app role, no policy. A file's bytes are read by its id under the files rule, as before; the row that names the file is under its table's policy  |
| The queue's tables (pg-boss, River)           | the owner's: the queue client and the worker connect as the owner, and the app role is granted nothing there                                                            |
| Triggers                                      | `osl_tenant` on a table with a derived column, `SECURITY DEFINER`. A trigger a later round adds on a tenant table runs as the statement's role unless it says otherwise |
| Queries a handler makes                       | on the request's connection, as the app role, bound to the caller's tenants; a subquery on another tenant table is under that table's policy too                        |
| Queries a job makes                           | as the owner, unbound, seeing every tenant: a job that acts for one tenant filters by it itself                                                                         |
| Functions that see past the policy            | `osl_memberships`, `osl_exists_<table>`, `osl_read_<table>_<path>`: each answers one named thing, is owned by the migrating role and granted to the app role alone      |
| Invite tables (round A4, at the merge)        | tenant tables like any: `team_invites` by its declared `team_id`, `channel_invites` with a derived one; the inviter's requests read and write them, an invitee reads none |
| Functions an invite adds                      | `osl_invite_<table>(token_hash)` and `osl_invites_<table>(email, at)`: the tenant a token, or a proven address, leads into, which the request then binds (`designs/invites.md`) |

## Declined, with the sentence the reference gets

- A public alternative on create, update, delete or a row action of a tenant table: the write policy would have
  to be compiled too, and nothing has asked for it; the reference says "a public write on a tenant table needs
  `isolation: none`".
- A "current team" per request (a team switch): the memberships array keeps today's semantics; a team switch is a
  product decision the model does not make.
- Search functions with elevated rights so that substring search can use a trigram index under the policy: OSL
  creates no trigram index today, so search is correct and no slower than it is; noted for when it does.
- Per-tenant connection limits and pools: operations, not the model.
- A tenant key that is not a uuid (M127): the create handler must know the key before the insert; a sequence would
  need its own grant and a round trip. Noted for whoever asks.
- A strict mode that throws on an unbound statement: unbound, the app role reads no tenant row, which is the
  property; throwing would be a second mechanism for it.
- Comparing constraints in the drift check, the composite keys among them: the drift check compares no
  constraint yet; a quality round's.

## Proof

- Fixture: workspace gains `isolation: database` through WS-13, whose diff is `set_auth` with the key and one
  scenario. Every earlier scenario passes unchanged on all three backends (165 steps each), which proves the
  statuses did not move. The new scenario (27 steps) states the one observable change: an assignee removed from the
  team gets 403 for the task, may not update it, lists none of the team's tasks and still reads a public
  project's task; someone in two teams lists the tasks of both in one request. The snapshot shows the policies,
  the role, the functions and the derived `team_id` on Task, Note, Milestone, ChannelMember and Message.
- The harness runs the fixture as it is deployed: the database belongs to a role made for the run that is no
  superuser (migrations, the queue, the worker's timer and the walks' own reads go through it), and the app
  serves as a login that is a member of `workspace_app`.
- The cross-tenant walk (`conformance-walks.md`) passes as before, and then a second time with the generated rule
  checks switched off (`POST /api/osl-hooks/rules/off`, under `OSL_TEST_HOOKS=1` only): every id-taking operation
  on the home team's rows is still refused with the rows unchanged, no list shows them, and a create naming the
  home team's parent is refused, by the database. A control runs first: a list the rules refuse a caller without
  a session must now answer 200 with no row, or the hook did nothing.
- The unbound probe (`GET /api/osl-hooks/tenancy/unbound`): the app role with no tenant bound reads no row of any
  tenant table, except exactly the rows a public read rule opens, which the harness computes with its own
  evaluator and compares by id.
- Negative controls, run by hand against the migrated fixture on each backend: with the tenant policy of `tasks`
  replaced by `USING (true)` the scenarios still pass, the drift check names the policy, and the walk's second
  pass fails on the task (listed, read, updated, deleted); with row security forced on two tables the drift check
  names them and the scenarios fail at the first membership read, which is what decision 4 avoids; with
  `DATABASE_APP_URL` pointed at the owner the app refuses every request (TypeScript) or to start (Go).
- Models without the key generate byte-identical output: the blog and todo snapshots match unchanged, and the
  workspace project built through WS-9 matches the snapshot committed before this round.
- Eval cases: `fx-ws-13-isolation` (the fixture's diff as the oracle), `ws2-database-isolation` (the ask in the
  security review's words) and `empty-clinic-isolation` (isolation from the first intent, with a derived column
  the diff must not write by hand). The expectation checks read rules as the model declares them, so a case over
  an isolated model names the rule it wants, not the compiled one. The four cases over the whole workspace
  fixture are pinned through WS-9, the model they were written against.

## Size

Core: the tenancy key, the tenant tables and the compiled rules in the IR, the layer's objects and the migration
steps (column, backfill, unique, composite key, role and grants, functions, trigger, policies), drift, five
diagnostics, the reference. One request scope per TypeScript backend and a scope type in Go, the second
connection string in the environment, README and Docker files. The walk's second pass and the probe in the
harness, and its non-superuser owner. About the size of the scheduling round, mostly in migrations and the harness.
