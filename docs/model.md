# The model and its diffs

The model is the declared state of an application. It lives in `.osl/model.yaml`, written only by `osl apply` from diffs. This page is the same reference that `osl propose` and the MCP server give to agents.

A diff is YAML with `osl: "1.0"`, an optional one-line `summary`, and `ops`, a list applied in order.
Every op has an `op` key. Validation runs after all ops, so order within one diff is free.

## Ops

- `set_description` { description }
- `add_entity` { name: PascalCase, entity: Entity }
- `remove_entity` { name } (fails while other entities, resources or auth still reference it)
- `rename_entity` { from, to } (updates relations, resources, events and auth; migrations emit RENAME)
- `add_field` { entity, name: snake_case, field: Field }
- `update_field` { entity, name, field: Field } (replaces the field definition)
- `remove_field` { entity, name }
- `rename_field` { entity, from, to } (updates rules, indexes, resource options; migrations emit RENAME)
- `set_rules` { entity, rules: Rules }
- `set_indexes` { entity, indexes?: Index[], unique?: string[][] }
- `set_relations` { entity, relations: { <name>: { through: <JunctionEntity>, from?, to? } } } (replaces the entity's whole relations block; {} removes it)
- `set_archive` { entity, archive: true | { field?, rule? } | false } (true or options: the entity archives, and gets its `archived_at` field if it lacks it; false: it no longer does, and the field stays)
- `add_resource` { name: snake_case, resource: Resource }
- `update_resource` { name, resource: Resource } (replaces the whole resource: repeat the operations, list options and actions you keep)
- `remove_resource` { name } (also drops the events, scenarios and seed steps that used it; do not remove those separately)
- `set_auth` { auth: Auth } / `remove_auth` {} (set_auth replaces the whole auth block; remove_auth leaves actors and signed-in scenarios behind, which then fail validation: remove them in the same diff)
- `add_event` { event: { on: "<Entity>.created|updated|deleted", handler: snake_case } } / `remove_event` { on, handler }
- `set_actors` { actors: { <name>: { email, password, ...identity fields, role } } } (replaces every actor; repeat the existing ones)
- `add_scenario` { scenario: Scenario } / `remove_scenario` { name }
- `set_seed` { seed: Step[] } (steps without expect, replayed by osl seed)
- `set_schedules` { schedules: Schedule[] } / `set_timers` { timers: Timer[] } (replace the whole list; see Schedules and timers)
- `set_app` { app: App } / `remove_app` {}
- `add_page` { name: snake_case, page: Page } / `update_page` { name, page } / `remove_page` { name }
- `set_sidebar` { sidebar: Sidebar }
- `add_action` { resource?, name: snake_case, action: Action } / `update_action` { resource?, name, action } / `remove_action` { resource?, name } (omit resource for a global action; remove_action also drops its events and the scenarios that call it)
- `set_files` { files: { upload?: Rule, read?: Rule } } / `remove_files` {}

## Entity

```yaml
table: posts # optional, default snake_case plural of the name
description: optional
fields:
  <name>: Field # order matters for the generated code
rules: { read, create, update, delete, hidden } # each rule: a predicate, or several joined with " or " (any allows) and " and " (all must)
# predicate: public | authenticated | none | owner:<field> | role:<value> | member:<field>[:<role>]; <field> may be a path (article_id.author_id), and a member path may end in a membership relation (channel_id.members)
# hidden: forbidden (default) | not_found   # what a row the read rule hides answers when addressed by id
indexes: [{ fields: [a, b], unique: false, name: optional }]
unique: [[a, b]] # multi-column unique constraints
relations: { genres: { through: TrackGenre } } # many-to-many: the rows a junction entity links this one to (from, to: the junction's two relation fields, when it has more)
archive: true # rows can be archived and restored; or { field: archived_at, rule: "member:team_id:admin" } (see Archive)
```

Default rules: read public; create, update and delete are authenticated when auth exists, public otherwise.
`none` leaves the operation out: its route does not exist, so a call answers 404, never 403.
Alternatives: `update: "owner:author_id or role:admin"` lets the author edit their own post and an admin edit any one;
when no alternative allows, anonymous callers get 401 and signed-in ones 403. Add an alternative only when the ask
names it ("only the author" means owner alone).
A predicate may carry a row condition: `read: "public when published = true or owner:author_id"` lets anyone read
published rows and authors their drafts; `update: "owner:author_id when status = draft"` freezes a row once it
leaves draft. `when <field> = <value>` (or `!=`) names a field of the entity and a literal: true or false, a
number, an enum value, a string without spaces, or null. Lists are filtered by it, get, update and delete check the
row, and on create the body (with the field's default) must satisfy it. The field may be a path through relation
fields to a field of the row they reach: `read: "public when project_id.public = true or member:project_id.team_id"`
on Task opens the tasks of public projects to everyone, `create: "owner:author_id when article_id.locked = false"`
on Comment refuses comments on a locked article (403; a missing related row refuses too). Lists follow the path with
a subquery; a timer's `when` takes the same paths. What a client may write into a field still cannot depend on who
they are (no "only owners may grant owner"): say so in not_delivered rather than approximating.
Predicates joined with `and` must all allow: `create: "member:project_id.team_id and owner:author_id"` lets only a
member of the project's team create, and binds author_id to the session as a plain owner rule does, so a member
cannot file a note under another name. `and` binds tighter than `or` (`a and b or c`); `none` never belongs
in a conjunction and `public` adds nothing to one (M034). When a conjunction refuses, the status is 401 only when the
part that failed needed a session and there was none, otherwise 403.
`hidden: not_found` beside the rules answers a get, update, delete or row action of a row the read rule hides from the
caller with the same 404 a missing row gets, so a draft or another team's row does not reveal that it exists; the
operation's own first check (401 without a session when every alternative needs one, 403 for a wrong role) still
answers before the row is loaded, the same for every id. The default, `forbidden`, answers 401 or 403. Set
`not_found` when the ask says a hidden row must look as if it did not exist (a 404, "never see", "does not exist
for them"); keep the default when the ask says refused or says nothing. It has no effect when the read rule never
hides a row (M035).
`owner:<field>` needs auth; the field must be a relation to the identity entity (or the identity's own primary key).
A path follows relation fields to a row that is not the one being accessed: `owner:article_id.author_id` on Comment is
the author of the comment's article, `member:project_id.team_id` on Task is membership of the task's project's team.
Every segment but the last must be a relation field of the entity reached so far. Lists are filtered through the relations.
On create with a plain owner rule, the owner field is set from the session and is not accepted from the client. With any
other create rule (a path, member, or alternatives without a plain owner) the client sends the relation field itself and
the related row is checked, so a required relation must stay in `create.fields`.
`role:<value>` needs a `role` field on the identity entity; an actor with `role: <value>` tests it from the allowed side.
`member:<field>` needs `auth.tenancy`; the field is a relation to the tenant entity (or the tenant's own primary key):
the user must have a membership of that tenant, with `member:<field>:<role>` at least that role (roles rank in the order
the membership's enum declares them, first is most privileged). Lists show only rows of the user's tenants; on create the
client picks the tenant and must be a member of it.
`member:` may also end in a membership relation: a reverse relation (declared with `reverse:` on a junction's relation
field) whose entity has a relation to the identity. `member:members` on Channel is the channel's own members,
`member:channel_id.members` on Message the members of the message's channel, `member:collaborators` on Playlist its
collaborators, and `member:author_id.followers` on a row with an author means the caller follows the author (the member
is the junction's other relation to the identity). The caller is a member when a row of that entity points at the row
reached and at them; this needs auth but not tenancy. `member:shares:edit` names a value of an enum field marked
`ranked: true` on the membership entity (values rank in declared order, first most privileged) and allows that value or a
higher one; without a ranked enum, membership is all or nothing. Lists show only rows the caller is a member of; on create
the client sends the relation the path starts with and must be a member of the row it names, and `and owner:author_id`
binds the author as usual. Choose it when the ask shares or adds people to one row (a playlist, a channel, a page), and
tenancy when every row of the app belongs to a team. Whoever creates the parent adds themselves through an owner path:
`create: "owner:channel_id.created_by or member:channel_id.members:admin"`. A membership relation ends a path: a right
granted through a second junction (a page shared with a team, read by the team's members) is not expressible, say so in
not_delivered; a membership counts as soon as its row exists (keep pending invites in their own entity); a role ranks
within one junction, and two junctions rank through alternatives.

## Field

```yaml
type: string | text | integer | bigint | float | decimal | boolean | datetime | date | time | uuid | json | enum | array | bytes | file
primary: true # one or more fields; a single uuid primary gets a generated uuid, a single integer gets an identity
required: true # NOT NULL; defaults to false
unique: true
default: <literal> | now (datetime) | uuid (uuid)
max_length: 255 # strings only; default 255
enum_values: [a, b] # enum only
array_type: string # array only: string text integer bigint float decimal boolean uuid
validate: { format: email|url|uuid, min_length, max_length, pattern, min, max }
relation: # makes this field a foreign key; type must match the target's primary key type
  entity: User
  kind: many_to_one | one_to_one # one_to_one needs unique: true on the field
  name: author # relation name here; default is the field name without _id
  reverse: posts # relation name on the target entity (optional)
  on_delete: restrict | cascade | set_null # set_null needs a nullable field
hidden: true # never returned by or accepted from the API
read_only: true # returned by the API but never accepted from it: register, create and update answer 400 when a client sends it
ranked: true # enum only: the values rank in declared order, first most privileged, for member:<path>:<value> on a membership entity
position: { within: album_id } # integer only: the row's place among the rows with the same album_id, kept by the server (see Ordered collections)
count_of: comments # integer only: how many rows the reverse relation `comments` holds, kept by the database (see Counts)
where: "approved = true" # with count_of: only the related rows this holds for count
file: { accept: [image/*, application/pdf], max_size: 5242880 } # file only: what uploads it takes (sizes in bytes)
```

A `read_only` field is one the server owns: a `banned` flag, a `reviewed_at` stamp, a `view_count`. Only your action
handlers (and its default) set it, so declare the action that does, and give the field a default or leave it optional
(a required one without a default could never be created). Mark the identity's `role` read_only the same way. Example
actors may still set read_only identity fields: the harness writes them into the database after registering the actor.

A `file` field holds an uploaded file. Clients upload first (`POST /api/files` with { name, type, size } answers an
upload URL and method; PUT the bytes there; `POST /api/files/{id}/complete`), then write the file's id into the field.
The API returns the field as { id, name, size, type, url }. File fields cannot be filtered, sorted, searched or listed in a
page's columns. Who may upload and read is `files: { upload, read }` (defaults: upload authenticated when auth exists,
read public).

Every entity needs a primary key: mark fields `primary: true` or include an `id` field.
A junction table is an entity whose two relation fields are both `primary: true`. With that key it has no resource: give it an `id` and
`unique: [[a_id, b_id]]` instead when clients add and remove the links.
Only entities with a single-column primary key can have resources.

Many-to-many goes through a junction entity you declare: an `id`, a required relation field to each side,
`unique: [[track_id, genre_id]]` when a pair may exist only once, its own rules and its own resource (`track_genres`
with create and delete is how a genre is put on a track and taken off again, and its rules say who may). What a link
carries (an added-at stamp, a position, a role) is a field of the junction. Then name the far rows once, on the entity
that shows them: `relations: { genres: { through: TrackGenre } }` on Track, and `relations: { tracks: { through:
TrackGenre } }` on Genre when that side shows them too. `include: [genres]` on list or get returns the Genre rows
themselves (`genres: [{ id, name }]`), so a track shows names where it showed ids. The far rows come in the junction's
order when the junction has a position within the near relation, and by their display column otherwise. `from` and `to`
name the junction's two relation fields when it has more than two, or two to one entity (`following: { through:
Follow, from: follower_id, to: followee_id }`). An entity that exists gets its relations with `set_relations`.
A link is a row of the junction, written through the junction's resource, one request each: the parent's create and
update take no `genre_ids`, and a list is not filtered by a far row (the tracks of a genre are `genres.get` with
`include: [tracks]`, or the junction's list filtered by `genre_id` with `include: [track]`). A far row is returned
whatever its own read rule says, like every included row: do not include rows the reader may not see. Under
`isolation: database` a junction between two tenant tables declares its own required relation to the tenant (M115),
a link names that tenant (`team_id`), and both rows must be that tenant's (a link across tenants is a 400).

Ordered collections: `position: { within: <relation field> }` on an integer field gives every row a place among the
rows with the same parent, 1 for the first, no two alike. The server owns the field; write only `type: integer` and
`position` (it is required and read-only already, and takes no default). Create appends the row at the end of its
parent and answers 400 when a client sends the field. A delete closes the gap. Lists come parent by parent in that
order unless the resource declares `list.order`, and so do the parent's `include` of the reverse relation and a
relation through an ordered junction. A resource over the entity has a `move` row action without declaring it:
`POST /api/<resource>/{id}/move` with `{ to: <place> }` puts the row at that place and shifts the others (1 is first, a
place past the end is last, below 1 is a 400), answers the row, and is allowed by the entity's update rule (`update:
none` leaves no move). Scenario steps call it as `tracks.move` with `body: { to: 1 }`. `within` is a required relation
field to another entity: tracks `within: album_id`, playlist entries `within: playlist_id` on the junction. A row keeps
its parent, so that field is not accepted by update. Never declare an action named `move` on such a resource (M143)
and never write a handler that renumbers; concurrent creates, moves and deletes in one parent are safe. When a row
goes with a cascade from elsewhere (a track deleted from the catalog leaves every playlist), the gap closes too: at
once when nothing else is writing that parent, and otherwise with its next move or delete, so places are always in
order and never shared. Not expressible, say so in not_delivered: an order over a whole table, an
order within an optional or a self relation (a tree of pages, nested blocks), moving a row to another parent in one
call, creating at a given place (create, then move), an event on move.

Archive: `archive: true` on an entity is "removed but recoverable": use it when the ask says rows are archived, put
away, hidden from the list or soft-deleted and can come back. It gives the entity a read-only nullable datetime
`archived_at` (do not declare it; `{ field: <name> }` names another), and every resource over the entity gets two row
actions without declaring them: `POST /api/<resource>/{id}/archive` sets the field and `.../restore` clears it, each
answering the row, 409 when there is nothing to do (already archived, not archived), under the entity's update rule
or `archive: { rule: "<rule>" }` when someone else decides ("only admins archive"). A list leaves archived rows out;
`?archived=true` answers the archived rows instead (never both: a client that wants both asks twice). Get, update
and delete treat an archived row like any other, and so do includes: a row still shows the archived row it points
at or carries through a junction, with its `archived_at` set. What else an archived row may not do is the rules' to
say: `update: "owner:author_id when archived_at = null"` freezes it. A row with a `position` keeps its place while
archived. Scenario steps call `projects.archive` and `projects.restore` with no body and list archived rows with
`query: { archived: "true" }`; events follow them (`on: projects.archive`); a dashboard tile counts archived rows with
`filter: { archived: true }` and a page shows them with the same filter, neither needing a list filter. Pages get a
"Show archived" switch. Never declare an action named `archive` or `restore` on such a resource (M151), never add an
`archived` flag with a list filter beside it (M157), and never write a handler for it. Delete is unchanged: keep it
for "gone for good", or set `delete: none` when archiving is the only way out. Not expressible, say so in
not_delivered: archiving a row archives the rows under it (an event handler on `projects.archive` may), a list of
live and archived rows together, a timer that runs archive itself (declare an action whose handler sets the field
and run that; a timer may wait on `archived_at` to purge), archived rows hidden from includes.

Counts: `count_of: <reverse relation>` on an integer field is "how many related rows": comments of a post, tasks of
a project, members of a team. The relation is the `reverse` name a relation field of the counted entity declares
(`Comment.post_id` with `relation: { entity: Post, reverse: comments }` gives `Post.comment_count: { type: integer,
count_of: comments }`); give that field a `reverse` name if it has none. The database keeps the number in the row,
whoever writes the counted rows (a handler of yours, a seed, a cascade), and it is exact under concurrent writers.
Write only `type: integer` and `count_of`: the field is never null, starts at 0, is read-only (create and update
answer 400 when a client sends it) and can be filtered, sorted and shown like any integer. `where` counts only the
rows it holds for, in the rules' spelling on fields of the counted entity, joined with `and`: `where: "done =
false"`, `where: "approved = true and archived_at = null"`. Without `where` every row counts, archived ones too:
say `archived_at = null` to leave them out. A count is a field of the row it sits on: whoever may read that row
reads the number, whatever the rules of the counted rows say, so do not count rows whose number the row's readers
may not know. Under `isolation: database` a count on a shared row over a tenant table adds up every tenant's rows
(M156 warns). Never keep such a number with a handler, an event or a `read_only` field of your own. Not
expressible, say so in not_delivered: a sum, an average, a maximum or a latest value (a `read_only` field a handler
keeps), a count over a path of two relations or through a junction's far side (count the junction's rows), a count
per viewer (unread for me), a count grouped by a value (reactions per emoji).

## Resource

```yaml
entity: Post
path: /api/posts # optional, default /api/<resource name>
operations: [list, get, create, update, delete]
list:
  {
    filters: [published],
    order: [[created_at, desc]],
    page_size: 20,
    include: [author],
    sortable: [title, created_at],
    search: [title, content]
  }
# page_size is the default page; clients may ask for fewer or more rows with ?page_size=, up to 200 (more is a 400). No key raises that cap.
get: { include: [author] }
create: { fields: [title, content] } # optional; default is every writable field
update: { fields: [title, content] }
actions: # operations beyond the five; see Actions
  publish: { rule: "owner:author_id" }
```

`sortable` lets a client pass `sort=<field>:asc|desc`; `search` lets it pass `q` to match those string fields as a
case-insensitive substring. Writable fields exclude primary keys, hidden and read_only fields, and fields with generated defaults (now, uuid, identity).
`include` names relations: forward ones declared on the entity's fields, reverse ones declared with `reverse`, and the
ones through a junction declared under `relations` (the far rows, as an array).
List returns `{ data: [...], page: { page, page_size, total } }`; get, create and update return `{ data }`; delete returns 204.
Errors are `{ error: { code, message } }` with 400 validation, 401 no session, 403 the rule refuses (also a get of a row
the read rule hides from this user, unless the entity sets `hidden: not_found`), 404 no such row, an id with the wrong
format or, with `hidden: not_found`, a row the read rule hides, 409 conflict (a unique value already taken, or a delete
another row still references).
The identity entity cannot have a create operation; users register through `POST /api/auth/register`.

## Actions

An action is an operation you implement, declared so the API, validation, rules, tests and docs come from the model.
Resource actions live under `resources.<name>.actions`; global ones under top-level `actions`.

```yaml
resources:
  posts:
    actions:
      publish: # POST /api/posts/{id}/publish; the handler gets the row
        scope: row # row (default) | collection (POST /api/posts/publish, no row)
        input: { note: { type: string, max_length: 200 } } # optional body fields (Field without storage options)
        rule: owner:author_id # default: the entity's update rule (row) or create rule (collection)
        returns: entity # entity (default for row) | none (204) | { <field>: Field } (a custom shape)
actions:
  send_digest: # POST /api/actions/send_digest
    rule: role:admin
    returns: { sent: { type: integer, required: true } }
```

The generated handler stub is `src/actions/<resource>_<name>` (or `src/actions/<name>`); it receives the validated input,
the row for row actions, the session (null when a schedule or timer runs it), the database and `now`, and returns the
row, nothing, or the declared shape. A handler is
where a `read_only` field gets its value (`ban` sets `banned` and `banned_at`). Scenario steps call actions as
`posts.publish` or `actions.send_digest`. Events may follow an action: `on: posts.publish`.

## Auth

```yaml
identity: User
providers:
  [
    credentials,
    magic_link,
    { oauth: github },
    { oauth: google },
    { oauth: oidc, issuer: https://id.example.com, name: example }
  ]
email_field: email # a required, unique string on the identity
password_field: password_hash # added by OSL with the credentials provider; never declare it
session_days: 30
tenancy: # optional: teams, workspaces, organisations
  entity: Team # the tenant entity
  membership: TeamMember # relation to the identity, relation to Team, a required role enum, unique on both relations
  role_field: role # roles rank in the enum's order, first is most privileged
  creator_role: owner # whoever creates a Team through its resource gets this membership
  isolation: database # optional: none (default) | database: row-level security on every tenant table, behind the rules
```

`provider: credentials` is the 1.0 spelling of `providers: [credentials]`. Credentials add `POST /api/auth/register`
(identity's writable fields plus password; `role` and read_only fields are never accepted) and `POST /api/auth/login`. Every model with auth
has `POST /api/auth/logout`, `GET /api/auth/me` and `GET /api/auth/providers`. `magic_link` adds
`POST /api/auth/magic-link` { email } (always ok) and `POST /api/auth/magic-link/verify` { token }; the email goes
through the app's email adapter. `oauth` adds `GET /api/auth/oauth/<name>` and its callback. Magic links and OAuth
create a user when the identity needs nothing but email (and name); otherwise the user registers first.

`isolation: database` puts a backstop in the database behind the rules: every tenant table gets row-level security,
the web process connects as a role the policies bind, and a request reaches only the rows of the tenants its caller
belongs to, whatever a handler forgets. A tenant table is the tenant entity, the membership, and every entity that
reaches the tenant through required relations (Task -> project_id -> Project -> team_id). The compiler derives the
tenant column and the composite keys of a table that does not declare its tenant: never add `team_id` by hand to an
entity that already has a required relation to a tenant table. An entity with two required relations that reach the
tenant declares a required relation to the tenant itself (M115); one that reaches it only through an optional relation
stays shared, with no policy (M116); the identity stays shared and the tenant's key is a uuid (M118). Under isolation a
signed-in caller reaches a tenant table's rows only as a member of the row's tenant: `owner:assignee_id` on Task
compiles as `owner:assignee_id and member:project_id.team_id` (M119 says where), so an assignee who left the team no
longer reads the task; write the rules as before. A public alternative (`public`, `public when project_id.public =
true`) is allowed on the read rule of a tenant table and compiled into its policy; on create, update, delete or a row
action it is an error (M117): a public write on a tenant table needs `isolation: none`. Statuses do not change:
another tenant's row still answers 403, or 404 under `hidden: not_found`. Turn it on with `set_auth`, repeating the
auth block with the key. In an action handler the database is bound to the caller's tenants: do outbound calls after
the write, not in the middle of the transaction the handler was given.

## Events

```yaml
events:
  - { on: Post.created, handler: post_created } # after a create, in the request
  - { on: posts.publish, handler: post_published, delivery: queue } # after the action, as a job the worker runs with retries
```

`on` is `<Entity>.created|updated|deleted`, `<resource>.<action>` or `actions.<action>`. `delivery` is `inline`
(default) or `queue` (a Postgres-backed job; the API runs the worker in-process unless started as web only).

## Schedules and timers

Work that runs on its own, on the same job queue as queued events; the API runs the worker in-process unless started
as web only. Both run an action's handler as the system: no session, no access rule.

```yaml
schedules:
  - { cron: "0 7 * * *", run: actions.send_reminders } # five cron fields, UTC; a global or collection action
  - { cron: "*/15 * * * *", run: invoices.sweep_overdue, input: { grace_hours: 48 } } # literal input when the action takes some
timers:
  - { on: Article, at: publish_at, run: posts.publish, when: "published = false" } # when publish_at passes, publish, if still unpublished
  - { on: Delivery, at: assigned_at, after: 48h, run: deliveries.flag_overdue, when: "status = assigned" }
```

A timer schedules a job when a row is created or updated with `at` set, due at `at` plus `after` (15m, 48h, 30d).
When it fires, the row is loaded again and the row action runs only if the field still gives that due time and the
`when` condition (the rules' spelling, on a field of the entity) still holds: a changed date needs no cancellation,
and a job never acts on stale data. Handlers get `ctx.now`, the time the job was due; compare against it, not the
clock. There is no derived field: "overdue" is a read_only flag a timer sets. Nothing compares a field against now
in rules or filters yet ("due before today", "upcoming events"): say so in not_delivered.

## App

The web app: pages and the sidebar that links them. Backends with a web app render it; API-only backends ignore it.

```yaml
title: Blog # sidebar header and document title; default: the model name
pages:
  posts: # page name, snake_case
    kind: resource # resource (default) | custom
    resource: posts # resource pages: a resource with list and get operations
    path: /posts # default /<name>; /login and /settings are reserved; one dashboard or custom page may take /
    title: Posts # default: the name in Title Case
    layout: split # split (list beside the selected row, default) | table (sortable, filterable, with a detail page) | board
    columns: [title, published] # master list columns; default: the first few short columns
    fields: [title, content, published] # detail pane fields; default: every output field (read_only ones show here, never in the form)
    access: authenticated # public | authenticated | role:<value>: who may open the page (sidebar and route); default authenticated with auth, else public
    filter: { author_id: "{actor.id}" } # resource pages: equality filters the list always carries, from list.filters; "{actor.id}" is the signed-in user (not on a public page)
    refresh: 15 # seconds; the page refetches its data on this interval while open (polling; there is no push)
  tasks:
    resource: tasks
    layout: board # cards grouped by an enum field; dragging a card updates it
    group_by: status
  home:
    kind: dashboard
    tiles: # count tiles from list filters; group_by makes one tile per enum value or per row of a related resource
      - { resource: posts, label: Published, filter: { published: true }, icon: file-text }
      - { resource: posts, label: By author, group_by: author_id }
      - { resource: tasks, label: Mine, filter: { assignee_id: "{actor.id}" } }
    recent: [{ resource: posts, limit: 5 }] # newest rows, linked
  about:
    kind: custom # scaffolded once as a route for you to fill in
    title: About
sidebar:
  items:
    - { page: posts, label: Posts, icon: file-text } # icon: a lucide icon name in kebab-case; label defaults to the title
    - { page: about, icon: info }
  footer: { user: true, settings: true } # user: avatar, name and sign-out (needs auth); settings: a /settings link
```

A resource page is a master/detail view: the list on the left (with a New action when the resource allows create),
the selected row on the right with edit and delete when the resource allows them. Hidden and binary fields cannot be
listed. Removing a resource that a page shows fails; remove the page first.
Boards show the count of cards in each column header. The detail pane renders the rows of every reverse relation the
get operation includes, and of every relation through a junction it includes: the far rows by name, with a control to
add one and to remove one when the junction has a resource whose list filters by the near field, and drag to reorder
when the junction is ordered. The children of an ordered entity (an album's tracks) are dragged into place the same
way. `columns` may name a relation through a junction that the list includes (`columns: [title, genres]`): the cell
shows the far rows' names. Anonymous visitors see every page whose resource is publicly readable; `access` narrows who
may open a page, it never widens what the API returns, so a public page needs a publicly readable resource (M092) and
a page filtered by `{actor.id}` cannot be public. A dashboard or custom page may take `path: /` as the landing
page; a resource page cannot. Filters are equality only: "due before today" or "starting after now" is not
expressible in a page, a tile or a list filter; say so in not_delivered. Pages scoped to one team, live push and
charts have no construct either (use `refresh` for polling; a custom page for the rest).

## Examples

Actors are users the tests register and sign in. Scenarios are ordered steps that become contract tests.

```yaml
actors:
  alice: { email: alice@example.com, password: alice-pass-1, name: Alice }
  admin: { email: admin@example.com, password: admin-pass-1, name: Admin, role: admin }
scenario:
  name: alice writes a post
  steps:
    - as: alice # omit for an anonymous request
      op: posts.create # <resource>.<operation> or auth.register|login|logout|me
      body: { title: Hello }
      expect: { status: 201, body: { data: { title: Hello, author_id: "{actor.id}" } } }
      capture: { post: data.id } # later steps use "{post}"
    - op: posts.get
      path: { id: "{post}" }
      query: { page_size: "10" }
      expect: { status: 200 }
```

Expected bodies match partially: every listed key must match, and every listed array element must match some element.
Every scenario step has `expect` with at least a `status`; a step without one is invalid.
All scenarios run in order against one database, each with every actor registered first, and the rows earlier
scenarios and steps made are still there: expect a list exactly only through a filter, a search or a unique title
that isolates what the scenario itself created, or check `page.total` on such a filter.
`{actor.id}` is the acting user's id. Only names an earlier step of the same scenario captured and `{actor.id}` resolve;
actors are not addressable by name (`{alice.id}` is nothing), so capture an id from `auth.me` or a create response first.
Passwords must be at least 8 characters. An actor carries what register
accepts (email, password, the identity's other writable fields) and may also set `role`, which register refuses:
the harness and `osl seed` register the actor, then write that field straight into the database, so a scenario can
act as an admin and show both the refusal of a member (403) and the admin's allowed call. The value must fit the
field (an enum value, a boolean); no other field register refuses can be set this way. Quote YAML strings that
contain a comma or a colon (`body: "Use the barrel first, then the tap"`), or a flow mapping splits them.
Steps may also call actions (`posts.publish`, `actions.send_digest`, with the action's input as `body`),
`files.get`, `auth.magic_link` { email } (200 with { data: { sent: true } }; under test the reply also carries
`data.debug.token`, so capture it) and `auth.magic_link_verify` { token } (200 and a session; an unknown or used
token is a 400), and upload a file:

```yaml
- as: alice
  op: files.upload # uploads the text as the file's bytes; 401 when uploads need a session
  body: { name: cover.png, type: image/png, content: not-really-a-png }
  expect: { status: 200, body: { data: { name: cover.png, type: image/png } } }
  capture: { cover: data.id } # then write "{cover}" into a file field
```

Time is an input to scenarios. `{now}`, `{now+2h}` and `{now-30d}` (m, h, d) resolve to timestamps in bodies and
expectations, and three test-only steps drive schedules, timers and mail; they exist only when the app runs with
`OSL_TEST_HOOKS=1`, which the harness sets, never in production:

```yaml
- as: alice
  op: posts.create
  body: { title: Later, content: Soon, publish_at: "{now-1h}" } # due in the past, so the timer is already due
  expect: { status: 201 }
  capture: { later: data.id }
- op: timers.run # run every timer due at that moment, as the worker would
  body: { now: "{now}" }
  expect: { status: 200, body: { data: { ran: 1 } } }
- op: posts.get
  path: { id: "{later}" }
  expect: { status: 200, body: { data: { published: true } } }
- op: schedules.run # run one schedule's action now, as the system
  body: { run: actions.send_digest, now: "{now}" }
  expect: { status: 200, body: { data: { ran: 1 } } }
- op: emails.sent # the mail captured since the app started, newest last; filter by to or subject
  query: { to: alice@example.com }
  expect: { status: 200, body: { data: [{ subject: Weekly digest }] } }
```

`seed` is a list of the same steps without `expect`; `osl seed` replays them against a running app to fill a
development database.
