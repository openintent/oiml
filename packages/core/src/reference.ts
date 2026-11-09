/**
 * The model and diff reference, in prose, for agents that write diffs
 * (osl propose, the MCP server) and for the docs.
 */
export const DIFF_REFERENCE = `# OSL model diff reference

A diff is YAML with \`osl: "1.0"\`, an optional one-line \`summary\`, and \`ops\`, a list applied in order.
Every op has an \`op\` key. Validation runs after all ops, so order within one diff is free.

## Ops

- \`set_description\` { description }
- \`add_entity\` { name: PascalCase, entity: Entity }
- \`remove_entity\` { name }  (fails while other entities, resources or auth still reference it)
- \`rename_entity\` { from, to }  (updates relations, resources, events and auth; migrations emit RENAME)
- \`add_field\` { entity, name: snake_case, field: Field }
- \`update_field\` { entity, name, field: Field }  (replaces the field definition)
- \`remove_field\` { entity, name }
- \`rename_field\` { entity, from, to }  (updates rules, indexes, resource options; migrations emit RENAME)
- \`set_rules\` { entity, rules: Rules }
- \`set_indexes\` { entity, indexes?: Index[], unique?: string[][] }
- \`add_resource\` { name: snake_case, resource: Resource }
- \`update_resource\` { name, resource: Resource }  (replaces the whole resource: repeat the operations, list options and actions you keep)
- \`remove_resource\` { name }  (also drops the events, scenarios and seed steps that used it; do not remove those separately)
- \`set_auth\` { auth: Auth } / \`remove_auth\` {}  (set_auth replaces the whole auth block; remove_auth leaves actors and signed-in scenarios behind, which then fail validation: remove them in the same diff)
- \`add_event\` { event: { on: "<Entity>.created|updated|deleted", handler: snake_case } } / \`remove_event\` { on, handler }
- \`set_actors\` { actors: { <name>: { email, password, ...identity fields, role } } }  (replaces every actor; repeat the existing ones)
- \`add_scenario\` { scenario: Scenario } / \`remove_scenario\` { name }
- \`set_seed\` { seed: Step[] }  (steps without expect, replayed by osl seed)
- \`set_schedules\` { schedules: Schedule[] } / \`set_timers\` { timers: Timer[] }  (replace the whole list; see Schedules and timers)
- \`set_app\` { app: App } / \`remove_app\` {}
- \`add_page\` { name: snake_case, page: Page } / \`update_page\` { name, page } / \`remove_page\` { name }
- \`set_sidebar\` { sidebar: Sidebar }
- \`add_action\` { resource?, name: snake_case, action: Action } / \`update_action\` { resource?, name, action } / \`remove_action\` { resource?, name }  (omit resource for a global action; remove_action also drops its events and the scenarios that call it)
- \`set_files\` { files: { upload?: Rule, read?: Rule } } / \`remove_files\` {}

## Entity

\`\`\`yaml
table: posts            # optional, default snake_case plural of the name
description: optional
fields:
  <name>: Field         # order matters for the generated code
rules: { read, create, update, delete }   # each: a predicate, or several joined with " or " (any allows) and " and " (all must)
# predicate: public | authenticated | none | owner:<field> | role:<value> | member:<field>[:<role>]; <field> may be a path (article_id.author_id)
indexes: [{ fields: [a, b], unique: false, name: optional }]
unique: [[a, b]]        # multi-column unique constraints
\`\`\`

Default rules: read public; create, update and delete are authenticated when auth exists, public otherwise.
\`none\` leaves the operation out: its route does not exist, so a call answers 404, never 403.
Alternatives: \`update: "owner:author_id or role:admin"\` lets the author edit their own post and an admin edit any one;
when no alternative allows, anonymous callers get 401 and signed-in ones 403. Add an alternative only when the ask
names it ("only the author" means owner alone).
A predicate may carry a row condition: \`read: "public when published = true or owner:author_id"\` lets anyone read
published rows and authors their drafts; \`update: "owner:author_id when status = draft"\` freezes a row once it
leaves draft. \`when <field> = <value>\` (or \`!=\`) names a field of the entity and a literal: true or false, a
number, an enum value, a string without spaces, or null. Lists are filtered by it, get, update and delete check the
row, and on create the body (with the field's default) must satisfy it. The field may be a path through relation
fields to a field of the row they reach: \`read: "public when project_id.public = true or member:project_id.team_id"\`
on Task opens the tasks of public projects to everyone, \`create: "owner:author_id when article_id.locked = false"\`
on Comment refuses comments on a locked article (403; a missing related row refuses too). Lists follow the path with
a subquery; a timer's \`when\` takes the same paths. What a client may write into a field still cannot depend on who
they are (no "only owners may grant owner"): say so in not_delivered rather than approximating.
Predicates joined with \`and\` must all allow: \`create: "member:project_id.team_id and owner:author_id"\` lets only a
member of the project's team create, and binds author_id to the session as a plain owner rule does, so a member
cannot file a note under another name. \`and\` binds tighter than \`or\` (\`a and b or c\`); \`none\` never belongs
in a conjunction and \`public\` adds nothing to one (M034). When a conjunction refuses, the status is 401 only when the
part that failed needed a session and there was none, otherwise 403.
\`owner:<field>\` needs auth; the field must be a relation to the identity entity (or the identity's own primary key).
A path follows relation fields to a row that is not the one being accessed: \`owner:article_id.author_id\` on Comment is
the author of the comment's article, \`member:project_id.team_id\` on Task is membership of the task's project's team.
Every segment but the last must be a relation field of the entity reached so far. Lists are filtered through the relations.
On create with a plain owner rule, the owner field is set from the session and is not accepted from the client. With any
other create rule (a path, member, or alternatives without a plain owner) the client sends the relation field itself and
the related row is checked, so a required relation must stay in \`create.fields\`.
\`role:<value>\` needs a \`role\` field on the identity entity; an actor with \`role: <value>\` tests it from the allowed side.
\`member:<field>\` needs \`auth.tenancy\`; the field is a relation to the tenant entity (or the tenant's own primary key):
the user must have a membership of that tenant, with \`member:<field>:<role>\` at least that role (roles rank in the order
the membership's enum declares them, first is most privileged). Lists show only rows of the user's tenants; on create the
client picks the tenant and must be a member of it.

## Field

\`\`\`yaml
type: string | text | integer | bigint | float | decimal | boolean | datetime | date | time | uuid | json | enum | array | bytes | file
primary: true          # one or more fields; a single uuid primary gets a generated uuid, a single integer gets an identity
required: true         # NOT NULL; defaults to false
unique: true
default: <literal> | now (datetime) | uuid (uuid)
max_length: 255        # strings only; default 255
enum_values: [a, b]    # enum only
array_type: string     # array only: string text integer bigint float decimal boolean uuid
validate: { format: email|url|uuid, min_length, max_length, pattern, min, max }
relation:              # makes this field a foreign key; type must match the target's primary key type
  entity: User
  kind: many_to_one | one_to_one     # one_to_one needs unique: true on the field
  name: author         # relation name here; default is the field name without _id
  reverse: posts       # relation name on the target entity (optional)
  on_delete: restrict | cascade | set_null   # set_null needs a nullable field
hidden: true           # never returned by or accepted from the API
read_only: true        # returned by the API but never accepted from it: register, create and update answer 400 when a client sends it
file: { accept: [image/*, application/pdf], max_size: 5242880 }   # file only: what uploads it takes (sizes in bytes)
\`\`\`

A \`read_only\` field is one the server owns: a \`banned\` flag, an \`archived_at\` stamp, a \`view_count\`. Only your action
handlers (and its default) set it, so declare the action that does, and give the field a default or leave it optional
(a required one without a default could never be created). Mark the identity's \`role\` read_only the same way. Example
actors may still set read_only identity fields: the harness writes them into the database after registering the actor.

A \`file\` field holds an uploaded file. Clients upload first (\`POST /api/files\` with { name, type, size } answers an
upload URL and method; PUT the bytes there; \`POST /api/files/{id}/complete\`), then write the file's id into the field.
The API returns the field as { id, name, size, type, url }. File fields cannot be filtered, sorted, searched or listed in a
page's columns. Who may upload and read is \`files: { upload, read }\` (defaults: upload authenticated when auth exists,
read public).

Every entity needs a primary key: mark fields \`primary: true\` or include an \`id\` field.
A junction table is an entity whose two relation fields are both \`primary: true\`.
Only entities with a single-column primary key can have resources.

## Resource

\`\`\`yaml
entity: Post
path: /api/posts                      # optional, default /api/<resource name>
operations: [list, get, create, update, delete]
list: { filters: [published], order: [[created_at, desc]], page_size: 20, include: [author], sortable: [title, created_at], search: [title, content] }
# page_size is the default page; clients may ask for fewer or more rows with ?page_size=, up to 200 (more is a 400). No key raises that cap.
get: { include: [author] }
create: { fields: [title, content] }  # optional; default is every writable field
update: { fields: [title, content] }
actions:                              # operations beyond the five; see Actions
  publish: { rule: "owner:author_id" }
\`\`\`

\`sortable\` lets a client pass \`sort=<field>:asc|desc\`; \`search\` lets it pass \`q\` to match those string fields as a
case-insensitive substring. Writable fields exclude primary keys, hidden and read_only fields, and fields with generated defaults (now, uuid, identity).
\`include\` names relations: forward ones declared on the entity's fields and reverse ones declared with \`reverse\`.
List returns \`{ data: [...], page: { page, page_size, total } }\`; get, create and update return \`{ data }\`; delete returns 204.
Errors are \`{ error: { code, message } }\` with 400 validation, 401 no session, 403 the rule refuses (also a get of a row
the read rule hides from this user: never 404), 404 no such row or an id with the wrong format, 409 conflict (a unique
value already taken, or a delete another row still references).
The identity entity cannot have a create operation; users register through \`POST /api/auth/register\`.

## Actions

An action is an operation you implement, declared so the API, validation, rules, tests and docs come from the model.
Resource actions live under \`resources.<name>.actions\`; global ones under top-level \`actions\`.

\`\`\`yaml
resources:
  posts:
    actions:
      publish:                        # POST /api/posts/{id}/publish; the handler gets the row
        scope: row                    # row (default) | collection (POST /api/posts/publish, no row)
        input: { note: { type: string, max_length: 200 } }   # optional body fields (Field without storage options)
        rule: owner:author_id         # default: the entity's update rule (row) or create rule (collection)
        returns: entity               # entity (default for row) | none (204) | { <field>: Field } (a custom shape)
actions:
  send_digest:                        # POST /api/actions/send_digest
    rule: role:admin
    returns: { sent: { type: integer, required: true } }
\`\`\`

The generated handler stub is \`src/actions/<resource>_<name>\` (or \`src/actions/<name>\`); it receives the validated input,
the row for row actions, the session (null when a schedule or timer runs it), the database and \`now\`, and returns the
row, nothing, or the declared shape. A handler is
where a \`read_only\` field gets its value (\`ban\` sets \`banned\` and \`banned_at\`). Scenario steps call actions as
\`posts.publish\` or \`actions.send_digest\`. Events may follow an action: \`on: posts.publish\`.

## Auth

\`\`\`yaml
identity: User
providers: [credentials, magic_link, { oauth: github }, { oauth: google }, { oauth: oidc, issuer: https://id.example.com, name: example }]
email_field: email            # a required, unique string on the identity
password_field: password_hash # added by OSL with the credentials provider; never declare it
session_days: 30
tenancy:                      # optional: teams, workspaces, organisations
  entity: Team                # the tenant entity
  membership: TeamMember      # relation to the identity, relation to Team, a required role enum, unique on both relations
  role_field: role            # roles rank in the enum's order, first is most privileged
  creator_role: owner         # whoever creates a Team through its resource gets this membership
\`\`\`

\`provider: credentials\` is the 1.0 spelling of \`providers: [credentials]\`. Credentials add \`POST /api/auth/register\`
(identity's writable fields plus password; \`role\` and read_only fields are never accepted) and \`POST /api/auth/login\`. Every model with auth
has \`POST /api/auth/logout\`, \`GET /api/auth/me\` and \`GET /api/auth/providers\`. \`magic_link\` adds
\`POST /api/auth/magic-link\` { email } (always ok) and \`POST /api/auth/magic-link/verify\` { token }; the email goes
through the app's email adapter. \`oauth\` adds \`GET /api/auth/oauth/<name>\` and its callback. Magic links and OAuth
create a user when the identity needs nothing but email (and name); otherwise the user registers first.

## Events

\`\`\`yaml
events:
  - { on: Post.created, handler: post_created }                       # after a create, in the request
  - { on: posts.publish, handler: post_published, delivery: queue }   # after the action, as a job the worker runs with retries
\`\`\`

\`on\` is \`<Entity>.created|updated|deleted\`, \`<resource>.<action>\` or \`actions.<action>\`. \`delivery\` is \`inline\`
(default) or \`queue\` (a Postgres-backed job; the API runs the worker in-process unless started as web only).

## Schedules and timers

Work that runs on its own, on the same job queue as queued events; the API runs the worker in-process unless started
as web only. Both run an action's handler as the system: no session, no access rule.

\`\`\`yaml
schedules:
  - { cron: "0 7 * * *", run: actions.send_reminders }                     # five cron fields, UTC; a global or collection action
  - { cron: "*/15 * * * *", run: invoices.sweep_overdue, input: { grace_hours: 48 } }   # literal input when the action takes some
timers:
  - { on: Article, at: publish_at, run: posts.publish, when: "published = false" }      # when publish_at passes, publish, if still unpublished
  - { on: Delivery, at: assigned_at, after: 48h, run: deliveries.flag_overdue, when: "status = assigned" }
\`\`\`

A timer schedules a job when a row is created or updated with \`at\` set, due at \`at\` plus \`after\` (15m, 48h, 30d).
When it fires, the row is loaded again and the row action runs only if the field still gives that due time and the
\`when\` condition (the rules' spelling, on a field of the entity) still holds: a changed date needs no cancellation,
and a job never acts on stale data. Handlers get \`ctx.now\`, the time the job was due; compare against it, not the
clock. There is no derived field: "overdue" is a read_only flag a timer sets. Nothing compares a field against now
in rules or filters yet ("due before today", "upcoming events"): say so in not_delivered.

## App

The web app: pages and the sidebar that links them. Backends with a web app render it; API-only backends ignore it.

\`\`\`yaml
title: Blog                        # sidebar header and document title; default: the model name
pages:
  posts:                           # page name, snake_case
    kind: resource                 # resource (default) | custom
    resource: posts                # resource pages: a resource with list and get operations
    path: /posts                   # default /<name>; /login and /settings are reserved; one dashboard or custom page may take /
    title: Posts                   # default: the name in Title Case
    layout: split                  # split (list beside the selected row, default) | table (sortable, filterable, with a detail page) | board
    columns: [title, published]    # master list columns; default: the first few short columns
    fields: [title, content, published]   # detail pane fields; default: every output field (read_only ones show here, never in the form)
    access: authenticated          # public | authenticated | role:<value>: who may open the page (sidebar and route); default authenticated with auth, else public
    filter: { author_id: "{actor.id}" }   # resource pages: equality filters the list always carries, from list.filters; "{actor.id}" is the signed-in user (not on a public page)
    refresh: 15                    # seconds; the page refetches its data on this interval while open (polling; there is no push)
  tasks:
    resource: tasks
    layout: board                  # cards grouped by an enum field; dragging a card updates it
    group_by: status
  home:
    kind: dashboard
    tiles:                         # count tiles from list filters; group_by makes one tile per enum value or per row of a related resource
      - { resource: posts, label: Published, filter: { published: true }, icon: file-text }
      - { resource: posts, label: By author, group_by: author_id }
      - { resource: tasks, label: Mine, filter: { assignee_id: "{actor.id}" } }
    recent: [{ resource: posts, limit: 5 }]                                                         # newest rows, linked
  about:
    kind: custom                   # scaffolded once as a route for you to fill in
    title: About
sidebar:
  items:
    - { page: posts, label: Posts, icon: file-text }   # icon: a lucide icon name in kebab-case; label defaults to the title
    - { page: about, icon: info }
  footer: { user: true, settings: true }               # user: avatar, name and sign-out (needs auth); settings: a /settings link
\`\`\`

A resource page is a master/detail view: the list on the left (with a New action when the resource allows create),
the selected row on the right with edit and delete when the resource allows them. Hidden and binary fields cannot be
listed. Removing a resource that a page shows fails; remove the page first.
Boards show the count of cards in each column header. The detail pane renders the rows of every reverse relation the
get operation includes. Anonymous visitors see every page whose resource is publicly readable; \`access\` narrows who
may open a page, it never widens what the API returns, so a public page needs a publicly readable resource (M092) and
a page filtered by \`{actor.id}\` cannot be public. A dashboard or custom page may take \`path: /\` as the landing
page; a resource page cannot. Filters are equality only: "due before today" or "starting after now" is not
expressible in a page, a tile or a list filter; say so in not_delivered. Pages scoped to one team, live push and
charts have no construct either (use \`refresh\` for polling; a custom page for the rest).

## Examples

Actors are users the tests register and sign in. Scenarios are ordered steps that become contract tests.

\`\`\`yaml
actors:
  alice: { email: alice@example.com, password: alice-pass-1, name: Alice }
  admin: { email: admin@example.com, password: admin-pass-1, name: Admin, role: admin }
scenario:
  name: alice writes a post
  steps:
    - as: alice                      # omit for an anonymous request
      op: posts.create               # <resource>.<operation> or auth.register|login|logout|me
      body: { title: Hello }
      expect: { status: 201, body: { data: { title: Hello, author_id: "{actor.id}" } } }
      capture: { post: data.id }     # later steps use "{post}"
    - op: posts.get
      path: { id: "{post}" }
      query: { page_size: "10" }
      expect: { status: 200 }
\`\`\`

Expected bodies match partially: every listed key must match, and every listed array element must match some element.
Every scenario step has \`expect\` with at least a \`status\`; a step without one is invalid.
All scenarios run in order against one database, each with every actor registered first, and the rows earlier
scenarios and steps made are still there: expect a list exactly only through a filter, a search or a unique title
that isolates what the scenario itself created, or check \`page.total\` on such a filter.
\`{actor.id}\` is the acting user's id. Only names an earlier step of the same scenario captured and \`{actor.id}\` resolve;
actors are not addressable by name (\`{alice.id}\` is nothing), so capture an id from \`auth.me\` or a create response first.
Passwords must be at least 8 characters. An actor carries what register
accepts (email, password, the identity's other writable fields) and may also set \`role\`, which register refuses:
the harness and \`osl seed\` register the actor, then write that field straight into the database, so a scenario can
act as an admin and show both the refusal of a member (403) and the admin's allowed call. The value must fit the
field (an enum value, a boolean); no other field register refuses can be set this way. Quote YAML strings that
contain a comma or a colon (\`body: "Use the barrel first, then the tap"\`), or a flow mapping splits them.
Steps may also call actions (\`posts.publish\`, \`actions.send_digest\`, with the action's input as \`body\`),
\`files.get\`, \`auth.magic_link\` { email } (200 with { data: { sent: true } }; under test the reply also carries
\`data.debug.token\`, so capture it) and \`auth.magic_link_verify\` { token } (200 and a session; an unknown or used
token is a 400), and upload a file:

\`\`\`yaml
- as: alice
  op: files.upload                 # uploads the text as the file's bytes; 401 when uploads need a session
  body: { name: cover.png, type: image/png, content: not-really-a-png }
  expect: { status: 200, body: { data: { name: cover.png, type: image/png } } }
  capture: { cover: data.id }      # then write "{cover}" into a file field
\`\`\`

Time is an input to scenarios. \`{now}\`, \`{now+2h}\` and \`{now-30d}\` (m, h, d) resolve to timestamps in bodies and
expectations, and three test-only steps drive schedules, timers and mail; they exist only when the app runs with
\`OSL_TEST_HOOKS=1\`, which the harness sets, never in production:

\`\`\`yaml
- as: alice
  op: posts.create
  body: { title: Later, content: Soon, publish_at: "{now-1h}" }   # due in the past, so the timer is already due
  expect: { status: 201 }
  capture: { later: data.id }
- op: timers.run                      # run every timer due at that moment, as the worker would
  body: { now: "{now}" }
  expect: { status: 200, body: { data: { ran: 1 } } }
- op: posts.get
  path: { id: "{later}" }
  expect: { status: 200, body: { data: { published: true } } }
- op: schedules.run                   # run one schedule's action now, as the system
  body: { run: actions.send_digest, now: "{now}" }
  expect: { status: 200, body: { data: { ran: 1 } } }
- op: emails.sent                     # the mail captured since the app started, newest last; filter by to or subject
  query: { to: alice@example.com }
  expect: { status: 200, body: { data: [{ subject: Weekly digest }] } }
\`\`\`

\`seed\` is a list of the same steps without \`expect\`; \`osl seed\` replays them against a running app to fill a
development database.
`;
