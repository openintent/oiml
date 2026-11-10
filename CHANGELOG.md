# Changelog

Versions are alpha releases of 1.0.0 until the road in `docs/roadmap.md` ends. Each construct is proven by a
fixture intent on all three backends before it is listed here.

## Unreleased

- Hardening after milestone B (2026-11-10; no construct, one diagnostic). A lock another request holds is no
  longer a server error: `lock_not_available` (55P03, a move or a remove on an ordered table that gave up after
  about ten seconds of a held row), `deadlock_detected` (40P01, as a delete of a counting row against a write of
  one of its counted rows can end) and `serialization_failure` (40001) answer 503 with `Retry-After: 1` and the
  code `busy` ("Another request is changing the same rows. Try again.") on drizzle-next and gin-pgx, where they
  answered 500 `internal`; under tRPC the error is `SERVICE_UNAVAILABLE`, which tRPC 11 answers with 503, and the
  app adds the header, also to a batch. The OpenAPI document names the 503 on every write beside its other error
  answers. The server does not send the statement again itself: a handler has hooks and events around it, and
  replaying one is left to a later round. Proven on a running music app of each backend with a second database
  connection holding the lock, for all three codes, and by a unit test that runs the two TypeScript mappers. And a
  model nobody could sign up to is refused: a field of the identity that must hold a value and that no sign-up
  fills is M189, where it was accepted and every `auth.register` then answered 400 on the column's NOT NULL. That
  is a `required` field without a default that is `sealed`, has `shape_by`, is `hidden`, bytes, a file or `role`,
  a `read_only` one that `rules.create` would have set from a session, and a key that is neither a single uuid or
  integer nor the email field; the message says what to do instead (make it optional, give it a default where it
  may have one, or keep it on an entity of its own with a relation to the identity).
- Field kinds, second half: sealed fields and typed JSON, with a shape per enum value (round B6 of the road to
  1.0.0, which this completes). `sealed: true` on a string or text field encrypts it at rest: `secret: { type:
string, sealed: true }` is written through the API and returned to nobody, and `token: { type: string, sealed:
true, read: "owner:owner_id" }` is returned to its owner only. The column is `bytea`; the value is sealed before
  a hook or the insert sees it and opened in the presenter, inside the field rule's branch, never for the server
  itself, so no event payload and no session carries one. A handler opens it by name (`unseal("<table>.<column>",
row.<column>)`, `seal.Open(...)` in Go). The stored bytes are one format on every backend, so a database moves
  between them with its key: `0x01`, a 12-byte random nonce, the AES-256-GCM ciphertext and its tag, bound to the
  table and the column. The key is `OSL_SEAL_KEY`, 64 hexadecimal characters, in no generated file; the app does
  not start without it, and a value that does not open (another key, bytes moved from another column) answers
  500 to a caller the rule allows and names the column in the log, never the value. A sealed field is no list
  filter, sort or search, is not unique or indexed (M185), is tested by no rule, cannot be renamed, and no field
  becomes sealed or stops being sealed: a migration has no key. `shape:` on a json field declares its keys in the
  spelling of an action's input (scalars, enums, arrays of scalars, one nested shape; M186 says why a key cannot
  be money, a relation, sealed or carry `read:`): a write is held to it and a wrong type at any depth, a missing
  required key, an unknown key or null answers 400 naming the key (`preferences.quiet_hours.to`); a key's
  default is stored when the writer leaves the key out; an update replaces the whole value; stored values are not
  rewritten or checked when a shape changes. `shape_by: { kind: { webhook: {...}, slack: {...} } }` gives the
  value one shape per value of a required enum field of the same entity (M187): a create and an update hold the
  value to the shape of the kind the row will have, and an update that changes the kind without sending the value
  answers 400 (M188 warns where an update can write the kind and not the value); the enum cannot be the field of
  `transitions`. The pages render a group of inputs, which follows the enum's select, and a password input that
  starts empty for a sealed field. The leak walk writes every sealed field as every caller, opens the stored
  bytes with the format's reference, stores bytes of its own for the app to read and bytes that cannot open; the
  fuzz walk bends every key of every shape and wants a 400 that names it. New keys: `Field.sealed`, `shape`,
  `shape_by`; diagnostics M185 to M188; `sealed` and `shapes` in eval expectations. Not built: key rotation, a
  check of the key at start, a sealed number or JSON value, an array of shapes, a shape on a transitions field.
  Fixture: blog FEAT-16 (integrations whose settings follow their kind, a signing secret a handler opens, a
  token for its owner, preferences and a recovery code on the user). Design: `docs/designs/field-kinds.md`.
- Field kinds, first half: sequences and money (round B6 of the road to 1.0.0; sealed fields and typed JSON
  follow). `type: sequence` is a number people quote: `number: { type: sequence, prefix: "INV-", scope: [team_id],
width: 6 }` gives each team INV-000001, INV-000002 and so on. The field is a read-only string, unique within
  its scope, and the database assigns it: a `BEFORE INSERT` trigger takes the scope's counter in `osl_sequences`
  with `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, so every writer gets a number (a handler of yours, a seed)
  and two creates at once never share one. The counter is written in the create's transaction: a create that
  fails or is refused takes no number, and a scope's numbers have a hole only where a row was deleted later. The
  fields of a scope are required and left out of update (M180, M183). A sequence that arrives on a table with rows
  numbers them in a table rewrite and seeds its counters; a rename keeps them. Under `isolation: database` the web
  role has no grant on the counter table and the trigger functions run with their owner's rights; M181 warns of a
  tenant table's sequence whose scope names no relation to the tenant, since one counter would tell every tenant
  how many rows the others made. `type: money` is an amount: `price: { type: money, currency: USD }`, or `total: {
type: money, currency_field: currency }` beside a required enum of ISO 4217 codes (M182). The column is
  `numeric(19, 4)`; on the wire an amount is a decimal string in both directions (`"19.99"` comes back as
  `"19.9900"`), and a JSON number, a fifth fraction digit, an exponent or a separator answers 400: nothing is
  converted or rounded, and no backend holds an amount in a float. `validate.min`, `max` and `default` on a money
  field are decimal strings, compared exactly. Amounts filter and sort as numbers; an update that changes a row's
  currency must send the amounts in it or answers 400 (M184 warns where an update can write the currency and not
  the amount); no rule's `when` and no count's `where` tests an amount. The pages take an amount in a text input
  beside its currency and show it from its string; the OpenAPI document says `string`, `format: decimal`. The fuzz
  walk sends every money field the shapes it must refuse, and the order walk sends eight creates at once into one
  scope of every numbered entity and wants eight numbers in a row. New keys: field types `money` and `sequence`;
  `Field.currency`, `currency_field`, `prefix`, `scope`, `width`; decimal strings in `validate.min` and `max`;
  diagnostics M180 to M184. Not built: sums over amounts, currency conversion, a currency through a relation, a
  number that restarts each year, a number assigned after create. Fixture: workspace WS-16 (invoices numbered per
  team with a total in the row's currency and a fee in dollars, under `isolation: database`). Design:
  `docs/designs/field-kinds.md`.
- Field-level visibility (round B5 of the road to 1.0.0). `read:` on a field is a rule in the spelling of the
  entity's rules; the field is in a response only for a caller the rule allows on that row, and absent, not null,
  for everyone else. The entity's read rule still decides whether the row is seen, so a field rule only narrows.
  It holds on every way a row leaves the server: get, list rows, included rows and the far rows of a relation
  through a junction, the answers of create and update (a writer the rule refuses does not get the value back), of
  `move`, `archive`, `restore`, every transition and an action that returns the row, and `auth.me`, register and
  login, which answer the caller's own row as their own session may read it. An event's payload is the row as the
  server reads it. On each backend one presenter per entity takes the viewer, and for an entity with a field rule a
  call without one does not compile; a model without `read:` generates what it did. A field rule reads the row and
  the caller only: a path through a relation or a membership relation is refused on a field (M171). So is `read:`
  on a hidden field, a primary key or a relation field (M170), on a position, the archive field or the field of
  `transitions` (M173), and naming such a field in `list.filters`, `sortable`, `order`, `search` or a `group_by`
  (M172); a rule's `when`, a count's `where` and a timer's `when` may still test it, and a `count_of` field may
  carry it. Writes follow the entity's rules as before: M174 warns when the create or update rule lets someone
  write a field its `read:` refuses them, M175 when a field with `read:` is unique (a repeated value still answers
  409). Under `isolation: database` nothing is added to the database and the rule is compiled as written, without
  the membership M119 adds to an entity's rules; M176 warns where `authenticated` or `role:` lets a signed-in
  caller who is not a member read the field on rows a public read alternative shows. `auth.me` answers `fields`
  beside `data` (`auth.session` under tRPC): per resource, whether the caller could read each such field on some
  row. The pages leave out the column and the new-row input of a field its viewer could never read, the detail row
  and the edit input where the row does not carry it, and send no field a form did not offer; a rule's condition
  on such a field is left to the API. In the OpenAPI document the property leaves `required` and says for whom it
  is there, and a field that gains `read:` is a breaking change (`optional_property`) its `update_field` explains.
  Scenarios say a key must be missing with `expect.absent: [data.budget]`. The leak walk now holds every row of
  every answer to the read rules of its fields, as its caller, and compares what each session is told of its
  fields. New keys: `Field.read`, `expect.absent`; diagnostics M170 to M176. Not built: a rule per field for
  writing, masking instead of leaving out, a field rule through a relation. Fixtures: workspace WS-15 (a budget and
  a count for a team's admins, an estimate for signed-in callers, under `isolation: database`) and blog FEAT-15 (a
  phone for the person and the admins on the identity, an editor note only admins read on an entity with
  transitions, archive and events). Design: `docs/designs/field-visibility.md`.
- State machines (round B4 of the road to 1.0.0). `transitions` on an entity names one `read_only` enum field and,
  per transition, the states it may start from, the state it ends in, who may run it (`rule`, default the update
  rule) and an optional datetime `stamp`. Each transition is a row action the compiler writes on every resource
  over the entity, with no handler of yours: `POST <resource>/{id}/<name>` checks the read rule and the
  transition's rule, then runs one conditional update, and a row whose state is not in `from` answers 409 with code
  `invalid_transition`; of two callers at once one moves the row. Scenario steps call it, events follow it, and a
  timer runs it as the system, where a row in another state is left alone; a transition with `rule: none` has no
  route and is a timer's alone. Timers now also run the compiler's `archive` and `restore` (round B3 refused that
  with M133), and after a timer ran one of these the entity's timers are scheduled again, so a second timer can
  wait on what the first one stamped. The statements of `archive`, `restore` and the transitions live in one
  generated module per backend (`generated/row-actions.ts`, `generated/rowactions` in Go), which handlers and
  timers both call: a project whose entities archive gets that file on its next generate. A board page grouped by
  the field shows the enum's values as columns and lets a card be dropped only on a column a transition takes it to
  from where it is, under a rule its viewer passes; the drop runs the transition, a refusal puts the card back, and
  the page needs no update operation. A detail pane shows a transition's button only on a row it starts from.
  Under `isolation: database` nothing is added to the database: the row is loaded under the policy, so another
  tenant's row answers what the rule answers (or 404 under `hidden: not_found`) before the update is tried. An
  archived row still takes its transitions; a count with a `where` on the field follows them. The rule walk
  predicts 200 or 409 from the row's state. New op and key: `set_transitions`, `Entity.transitions`; diagnostics
  M160 to M163, M151 for a transition named `archive` or `restore` on an archiving entity, and M087 for a board
  over a read-only enum without transitions. Not built: input on a transition, two state machines on one entity,
  a history of transitions; on the tRPC backend the code `invalid_transition` is the cause of a `CONFLICT` error
  and is not on the wire, like every code there. Fixtures: blog FEAT-14 (an editorial review beside the `publish`
  action, a timer that retires and one that archives, a count of approved articles), todo TODO-8 (the task flow
  beside the `complete` action, which keeps its handler, and the board) and workspace
  WS-14 (requests and approvals under `isolation: database`, with an expiry only a timer runs). Design:
  `docs/designs/state-machines.md`.
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
