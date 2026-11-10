# Design: field-level visibility

**Status: built 2026-11-10** (round B5 of the road to 1.0.0). Proposed on 2026-11-09 and built without a design
review stop, so every decision is the owner's to review; they are numbered under "Decisions", and the ones that
departed from the design below or from what the round was recommended to do say so. What changed from the design
while building: a field rule reads the row and the caller only, so a path through a relation, a membership relation
and a condition through a relation are refused on a field (M171), where the design had the presenters resolve
paths; `auth.me`, register and login answer the caller's own row as the caller's own session may read it, where
the design had them answer it in full; an event's payload is the row as the server reads it, every field with a
read rule included; the refusals reach further than filters, sort and search (a list's `order`, a `group_by`, a
relation field, a position, the archive field and the field of `transitions`); the `fields` map sits beside
`data` on `auth.me` and, under tRPC, on `auth.session`; the pages leave a field its viewer may not read out of
what a form sends, so an edit never overwrites it blind; the property leaves `required` in the OpenAPI schema and
the contract walk reports that as a breaking change an `update_field` explains; the proof is the harness's leak
walk, which now holds every row of every answer to the read rules of its fields, with a negative control, beside
the scenarios; the intents are workspace WS-15 and blog FEAT-15 (WS-11 and FEAT-12 were taken), and the eval ask is
new (no "manager cost" ask of an earlier round exists in the repository).

A field today is returned to everyone the read rule lets in, or to nobody (`hidden`). Hand-written applications of
OSL's shape have a third case on almost every entity that carries money, staffing or credentials: a cost that only
managers see, a salary only the owner sees, an internal note hidden from the lowest role. Both applications surveyed
for these notes wrote it by hand, one as a procedure flag that keeps a role out of certain outputs with a type-level
test that no output ever carries a column named like a secret, the other as a masking pass keyed on column names.
The gap clustering already has "per-field access" and "field-level" among its rule keywords, but no round has
reported the cluster yet; the asks below are the hand-written applications' own.

## What was asked

| Ask                                                                     | Verdict                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| A cost price visible to managers only; staff see the product without it | construct                                         |
| The lowest role reads everything except credentials and tokens          | construct, with a role alternative                |
| Only the owner of a profile sees their own contact details              | construct, with an owner predicate                |
| Only owners may grant the owner role                                    | still not delivered: a write rule, declined below |

## The construct

```yaml
entities:
  Product:
    fields:
      cost: { type: decimal, read: "role:manager or member:team_id:admin" }
```

A field with a `read` rule is present in a response only when the rule allows for this caller and this row;
otherwise the key is absent, not null, so a client can tell "no value" from "not for you". The rule takes `public`,
`authenticated`, `role`, `owner`, `member`, a row condition, `or` and `and`, over the entity's own fields; the
entity's read rule still decides whether the row is seen at all, so a field rule can only narrow.

- Where it applies: every way a row leaves the server to a caller (decision 3).
- Where the value would be learned without being returned, the model is refused (decision 6).
- Writes follow the entity's rules, unchanged. A field the create or update rule lets someone write whom `read`
  refuses is a warning (M174): say `read_only`, keep the field out of the operation's `fields`, or widen the rule.
- In a scenario, `expect.absent: [data.cost]` says a path must not be in the response; the partial match of
  `body` cannot.

## Decisions

Most consequential first. "Departure" marks where the build did something other than the design below it or the
round's recommendations; "Addition" what neither named.

1. **A field rule reads the row and the caller, nothing else (M171). Departure from the design's mapping**, which
   had the presenters resolve paths "with the existing subquery helpers". A presenter runs for every row on every
   way out: the rows of a list, the rows an include or a relation through a junction brought in, an action's
   result, an event's payload. Three things follow from letting it look a value up. A list of N rows makes N
   lookups per path, or every loader has to plan a second query for every entity it may include. A lookup can
   fail, so every presenter call becomes one that can. And under `isolation: database` the lookup runs under the
   caller's policy: for a row that came through the public-read policy, the parent a path crosses is hidden from
   the reader, so each path would need a definer function in the migrations, as B1's readers are for an entity's
   public alternative. A rule over the row and the session needs none of it: the presenter stays a pure function,
   there is nothing to forget and nothing for the database to add. What it costs: on an entity that reaches its
   tenant through a parent (Task, through Project), `member:project_id.team_id:admin` is refused on a field; the
   model gives the entity its own tenant relation (under `isolation: database` the composite keys of B1 hold it
   to the parent's), or keeps the value in an entity of its own with a read rule. The diagnostic says so. A later
   round can lift this for one hop without changing the grammar: `ColumnIR.read` is a full rule.
2. **One presenter per entity, and the viewer is its argument.** `present<Entity>(row, viewer)` in TypeScript,
   `models.Present<Entity>(row, viewer)` in Go, and no other way to the public shape. An entity without a field
   rule keeps the presenter it had, so a model without `read:` generates byte for byte what it did (all four
   fixtures matched their snapshots before the two intents were added), and for an entity with one a call that
   forgets the viewer does not compile on any backend.
3. **Every way out is covered** (point 1 of the round): get; list rows; the rows of `op.include`, forward and
   reverse; the far rows of `op.through`; the answers of create and update, so a writer who may not read a field
   does not get it back; the answers of `move`, `archive`, `restore` and every transition, presented in the
   handler as B4 left them; a handler-backed action that returns the row; `auth.me`, register, login and a magic
   link's verify. The creator of a new tenant is presented its row as the member they became in the same request
   (the session was read before the membership existed), so `member:id:admin` on a field of the tenant holds in
   the answer to its own create.
4. **The caller's own row is presented to the caller. Departure from the design**, which had `auth.me` answer
   it in full. A note an admin keeps on a user (`read: role:admin`) would have reached that user through
   `auth.me`. The session keeps the user as the server reads it, because the rules read it (a role its holder may
   not read still decides); what register, login and me answer is that row for the caller's own session.
   `read: "owner:id or role:admin"` is how a model says "theirs and the admins'".
5. **The server reads everything** (point 7). A handler gets the row itself. An event's payload, inline or
   queued, is the row as the server reads it: every field with a read rule, no hidden one, whoever caused the
   event and when nobody did (a timer). The payload cannot depend on the actor, and a handler is the server. What
   leaves to an outside party is round C3's: a webhook's subscriber and an audit entry's reader are viewers, and
   that round decides which (the sentence it gets: a field with `read:` is in a webhook payload or an audit diff
   only when its rule would allow the party it goes to, and left out when the party has no session to ask).
6. **Where a value would be learned without being returned, the model is refused** (point 3), each with a
   diagnostic that says how it would have been learned:
   - M172: `list.filters`, `sortable`, `search` (the design's three), a list's `order` and a `group_by` on a
     board or a tile. A default order passes over a `created_at` with a read rule, and an entity is named
     (`display`) by a field every reader gets.
   - M173: the field of `transitions` (409 against 200 tells the state to anyone the transition's rule lets
     through; a stamp carries `read:` freely), a `position` (the order of every list shows it) and the field of
     `archive:` (the lists already tell every reader which rows are archived).
   - M170: a hidden field, a primary key, and a relation field. **Addition**: an include, a reverse relation and
     a filter by it all tell which row a relation points at, so a relation cannot be kept back by a rule on its
     column; the fields of the row it points at can.
   - The server's own reads are fine and stay: a field with `read:` may be tested by an entity rule's `when`, a
     count's `where` and a timer's `when`. The rule is the server's, and what it shows (a row is readable, so its
     state is the one the rule names) is what its author wrote.
   - A count is a field: `read:` on a `count_of` field hides the number, and the trigger writes it whatever the
     rule says.
   - **Addition**, M175 (warning): a `unique` field with `read:` still answers 409 to a repeated value. Not
     refused, because the model asked for uniqueness; said, because it is a way to learn a value exists.
7. **Writes are unchanged, and M174 says when a writer is not a reader.** The warning compares the rules: it is
   silent when every alternative of the create or update rule implies an alternative of the field's (the same
   predicate, a higher role of the same membership, any predicate that needs a session against `authenticated`).
   `read: none` is allowed and means written, never returned, which `hidden` (never accepted either) does not say.
8. **Under `isolation: database` a field rule is compiled as written and nothing is added to the database**
   (point 5). B1's narrowing (M119) makes an entity rule agree with the policy behind it; no policy stands behind
   a field, and the field rule runs on a row the narrowed read rule already let through. For a row a member
   reads, the membership it would add is already true. For a row that came through the public-read policy,
   `public` in a field rule means every reader of the row, those the policy let in included, and an alternative
   that needs a session means any signed-in caller it allows, member or not; M176 warns where `authenticated` or
   `role:` stands on such a table without a membership beside it, and names the predicate to add. The test hook
   that switches the rule checks off for the tenant walk does not switch a field rule off (the presenters call
   the verdict itself, `judge`), since the walk is there to prove the policies and a field has none.
9. **The pages** (point 4). The session answers `fields`: per resource, whether this caller could read each
   field with a read rule on some row (the rule before any row; for a member predicate, whether a membership of
   that rank is held at all). A table leaves out the column of a field the viewer could never read, a new-row form
   its input; a detail pane leaves out the row and an edit form the input where this row does not carry the key;
   and neither form sends a field it did not offer, so editing a project's name does not write a budget the editor
   cannot see. A rule's condition on a field with a read rule is the API's to decide (`rulePredicate`), as a path
   through a relation already is: the page offers the control when the rest of the rule allows. For a visitor the
   answer is compiled into the client from the rules.
10. **`fields` sits beside `data` on `auth.me`** on the REST backends, and on `auth.session` under tRPC, which is
    the query its web app asks. The harness compares both with what the rules say of each actor.
11. **The contract** (point 6). A property with a read rule leaves `required` in its schema and gains "Present
    only for a caller this rule allows on the row: <rule>". `diffOpenApi` has a new kind, `optional_property`: a
    response property a client could count on may now be absent. `update_field` on the entity explains it; a
    field added with its rule is no change, and dropping a rule is none.
12. **`expect.absent`** is a list of dotted paths. Through a list a path holds for every row; a key that is there
    with null is present.
13. **The proof is a walk** (point 2). The leak walk holds every successful answer of every walk to the field
    rules as it arrives: for each row, and each row an include or a relation through a junction put under it, the
    harness reads the row and the caller's memberships from the database, predicts each field with the evaluator
    that predicts everything else, and wants the key there exactly when the rule allows. It runs through the
    tenant walk's second pass too, with the rule checks off.
14. **Diagnostics M170 to M176**, the round's block: the rules family (M02x, M03x) has no free code above the
    ones in use.
15. **Intents WS-15 and FEAT-15** (point 8), the next free numbers. The design's fixture grew: workspace hides a
    count that exists (`update_field`, so the contract walk has its change) and a field on a table with public
    rows; blog hides a field of the identity, one of an existing column and one only admins read on an entity
    with transitions, archive, a handler-backed action and events.
16. **Go**: a field with a read rule is a `models.Maybe[T]` with `json:",omitzero"`, set by the presenter. The
    viewer is an interface in `models` that `access` implements; `auth` cannot import `access`, so the app hands
    it `auth.Visibility` when it builds the service.

## Mapping, as built

- **Core**: `Field.read`, `ColumnIR.read` (a `RuleIR`, compiled as written), `ruledColumns`, `hasFieldRules`,
  `anonymousCouldRead`; `expect.absent` on a step; M170 to M176; `rename_field` rewrites a field rule and
  `remove_field` refuses a field one still names; the OpenAPI schema and `optional_property`; the reference.
- **drizzle-next and hono-trpc-vite** (`ts-common`): `generated/present.ts` holds `Viewer` (a session, null, or
  `SERVER`), the field rules, `visibleFields`, and per entity a presenter that sets a field with a read rule only
  when `reads` allows. The resource modules hand the session to every presenter and `SERVER` to an event's
  payload; `auth` keeps `shownUser`. `access` exports `judge` under isolation. The web client exports `fieldsOf`,
  and the pages filter columns, detail rows and form fields by it and by the row.
- **gin-pgx**: `generated/models/viewer.go` (`Viewer`, `Server`, `Maybe`); presenters take the viewer;
  `access.Viewer(session)`, `access.CreatorViewer`, `access.VisibleFields`, `judge` and `judgeRow` under
  isolation; `auth.Visibility`.
- **Scenarios**: `carries` (TypeScript) and `client.Carries` (Go) in the generated test clients, only where a
  scenario uses `absent`.
- **Harness**: `packages/conformance/src/fields.ts`, called by the listener every client reports to.

## Under `isolation: database`

| What               | Under isolation                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Tables, columns    | none added: a field rule has no column of its own                                             |
| Policies, triggers | none: row-level security decides rows, and a field rule runs after the row is read            |
| Functions          | none: the rule reads the row and the session, so nothing is looked up under the policy        |
| The field rule     | compiled as written, not narrowed by M119; M176 warns on a table with public rows             |
| A public row       | `public` in a field rule is every reader of it; a session alternative is any signed-in caller |
| Rule checks off    | field rules stay on (`judge`): the tenant walk's second pass is predicted like the first      |
| A count with read  | its `SECURITY DEFINER` trigger writes it as before                                            |
| A new tenant       | presented to its creator with the membership the same request made                            |

## Declined, with the sentence the reference gets

- A `write` rule per field ("only owners may grant the owner role"): what a client may write into a field would
  then depend on who they are, which the reference says the model does not express. The reason is the row
  condition on the body: an update rule with `when` already freezes a field by state; a per-field, per-caller
  write rule needs the before and after values and a second grammar. Logged as the "role changes" gap it belongs
  to.
- Masking instead of omitting (`****`): a client cannot tell a mask from a value; absence is the contract.
- A field rule through a relation, or through a membership relation (decision 1): "give the entity the field the
  rule needs, or keep the value in an entity of its own with a read rule".
- `read:` on a relation field, a position, the archive field and the field of `transitions` (decision 6).

## Proof

- **Fixtures.** Workspace WS-15 "budgets and estimates" under `isolation: database`: `Project.budget` and the
  existing count `Team.pending_requests` for the team's admins, `Task.estimate` for signed-in callers on a table
  with public rows. A member reads the project, alone and in the list, without the budget; changes it and is not
  told it back; the admin reads the new one; the creator reads the count in the answer to creating the team; a
  member does not, while it goes on counting; a visitor reads a public task without the estimate and a signed-in
  outsider with it (M176 says so); a filter by the budget is a 400. Blog FEAT-15 "contact details and editor
  notes": `User.phone` and the existing `User.banned_at` for the person and the admins, `Article.editor_note` for
  admins. `auth.me` answers the caller's own phone; another user, a visitor and the list do not get it, nor
  beside an article (`data.author.phone`) or under a user (`data.posts.editor_note`); the author creates, edits,
  submits, publishes, archives and restores and never gets the note back; the admin gets it in the answer to
  approving and to locking.
- **The walk**, on every backend: every answer's rows held to their field rules as they arrive, and each actor's
  `fields` answer compared. Blog: 1956 fields with a read rule predicted on 1236 rows as their caller, 735 present
  and 1221 absent. Workspace: 401 on 401 rows, 281 present and 120 absent, the tenant walk's pass with the rule
  checks off included. The contract walk reports one more breaking change on each fixture (`User.banned_at` and
  `Team.pending_requests` may now be absent), each explained by its `update_field`.
- **Negative control** (a scratch script, not a repository test): with the answer to an article's update
  presented as the server reads it, the scenario fails on the author's update and the leak walk names the calls
  where the note came back to someone the rule refuses.
- **Pages**, in a browser on both web backends as two users (a scratch script, 16 checks each): the owner's
  projects table has a Budget column, the member's has none; the member's detail pane, edit form and new-row form
  have no budget, and saving the edit sends none and leaves the budget as it was.
- **A model without a field rule**: blog through FEAT-14 and workspace through WS-14 generate, with the round's
  code, byte for byte the snapshots committed before it, on all three backends.
- **Eval cases**: `fx-ws-15-budgets`, `fx-blog-15-author-contact`, and two asks over empty models,
  `empty-product-costs` (a role) and `empty-staff-salaries` (an owner on the identity, with a write rule per field
  to decline).

## Size

Core: the key, the IR column, seven diagnostics, the OpenAPI change kind, the reference. The viewer through every
presenter site on the three backends, the `fields` answer, the page filters in the shared page generator, the
`absent` matcher, the harness's field watch. About the size of the hidden-rows round.
