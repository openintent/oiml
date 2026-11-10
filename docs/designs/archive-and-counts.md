# Design: archiving, and counts over relations

**Status: built 2026-11-10** (round B3 of the road to 1.0.0). Proposed on 2026-11-09 and built without a design
review stop, so every decision is the owner's to review; they are numbered under "Decisions", and the ones that
departed from the design below or from what the round was asked to consider say so. What changed from the design
while building: `archive` and `restore` are the compiler's actions through the mechanism round B2 made for `move`
(`ActionIR.builtin`), not a new action kind; the archive field is added when the model is parsed and written back
into `model.yaml`, with a new op `set_archive`; the proof is on Milestone and Label of the workspace fixture, not on
Project, which already archives by hand with a `status` enum (the sentence about WS-4 below was wrong and is
corrected); the count is kept by statement triggers that write each parent once in key order, with a fourth
trigger for TRUNCATE; where the counted rows are ordered within the row that counts them, an append takes the
parent the way a move does, which a test against a real database showed to be needed; a count under
`isolation: database` runs with its owner's rights; a timer cannot run `archive` itself; the intents are WS-13 and
FEAT-13. Proof: workspace WS-13 under `isolation: database` (45 scenario steps) and blog FEAT-13 (32 steps),
conformance 12/12 with six walks, the rule walk and the order walk now comparing every count with the rows it
counts, 195 unit tests with the database (182 and 13 skipped without), the order's own load of round B2 run with a
count in place at 400 writes per connection, the oracle gate 34/34.

Soft delete is the most repeated hand-written pattern in applications of OSL's shape. One of the two surveyed for
these notes carries an `is_active` flag on 182 tables; the other carries `archived_at` or `deleted_at` on every
user-facing entity with an archive and an unarchive procedure each, and every list query remembers, or forgets, the
filter. Denormalized counts come second: votes, replies, occurrences, items on hand, kept by hand-placed
increments or by a trigger, and read by every list and tile. Agents ask for both: "archived rows" under the rules
topics, counts under "computed and aggregate fields".

## What was asked, in the agents' words

| Ask                                                                                                                                                               | Where                                | Verdict                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| "Archiving a project takes it out of the way: members no longer see it or edit it, while the team's admins still see it and may edit it, to rename or restore it" | `fx-ws-4-archived-projects` (corpus) | expressible by hand, as WS-4 does; not the construct (see below) |
| "A team admin can archive a project. An archived project shows when it was archived. Nobody sets or clears that by editing the project"                           | `ws2-archive-project` (corpus)       | construct                                                        |
| "Projects can be archived with one operation. The dashboard shows how many projects are archived"                                                                 | `todo4-archive-projects` (corpus)    | construct, with the tile filter `archived: true`                 |
| "Authors can archive one of their articles, which marks it archived and records when. Archiving notifies in the background"                                       | `blog5-archive-action` (corpus)      | construct, with a queued event on `posts.archive`                |
| "Track how many times each post has been viewed ... the count is part of the post"                                                                                | `blog2-view-counter` (corpus)        | a handler today; `count_of` over a View entity                   |
| "Anyone can see how many likes a post has by listing them per post"                                                                                               | `blog2-likes` (corpus)               | `page.total` today; `count_of` makes it a column                 |
| "The total estimated hours still open, broken down by project"                                                                                                    | `gen-r7-09-admin-overview-dashboard` | not delivered: sums, declined below                              |

Archiving is expressible by hand, and workspace WS-4 does it another way than this note first said: Project has a
`status` enum with an `archived` value, and its rules test it (`member:team_id when status = active or
member:team_id:admin`), so an archived project is hidden from plain members and still listed for admins. There is no
`archived_at` and no action; an admin archives by updating the status. That is a rule about who sees a row, not a
row taken out of the list, and it stays what it is: the construct is proven on other entities (decision 7).

## 1. Archive

```yaml
entities:
  Milestone:
    archive: true # or { field: archived_at, rule: "member:project_id.team_id:admin" }
```

`archive: true` gives the entity a `read_only` nullable datetime `archived_at` (or names an existing one), and:

- Lists over the entity carry `archived_at IS NULL` unless the client asks `?archived=true`, which answers only
  archived rows the rules allow. Get, update and delete answer an archived row as any other. Dashboard tiles count
  live rows unless their filter says `archived: true`.
- Row actions `archive` and `restore` on every resource over the entity, under the entity's update rule or the
  `rule` given; `archive` on an archived row and `restore` on a live one answer 409. Events follow them
  (`on: projects.archive`). A timer cannot run them, and may wait on `archived_at`: archive and restore schedule
  the entity's timers as an update does.
- Delete is unchanged: an entity may have both, or set `delete: none` to make archiving the only way out, which is
  what the reference recommends when the ask says "removed" but a restore is wanted.
- Pages: resource pages gain a "Show archived" switch in the list's header, archived rows render muted, the detail
  pane offers Archive on a live row and Restore on an archived one, and the New and Edit forms are unaffected.

## 2. Counts over relations

```yaml
entities:
  Post:
    fields:
      comment_count: { type: integer, count_of: comments, where: "approved = true" } # comments: a reverse relation declared on Comment.post_id
```

An integer the database keeps: triggers on the related table (insert, delete, update, truncate) adjust the count,
and the migration that adds the field counts the rows that exist. `where` takes the rules' row-condition spelling
on fields of the related entity, one comparison or several joined with ` and `. The field is never null, starts at
0, is read-only, and is filterable, sortable and usable in tile filters like any integer.

Why a trigger rather than a subquery or a handler: one mapping serves all three backends, lists sort on a plain
column, and the count survives a handler the model wrote forgetting it.

## Decisions

Most consequential first. "Departure" marks where the build did something other than the design above first said
or than the round was recommended to do.

1. **The count is written by a statement trigger that waits for the counting row.** One function per count field
   and four statement triggers on the counted table (insert, delete, update, truncate). A statement's rows arrive
   as transition tables; the function adds up what the statement did per parent and writes
   `count = count + n` once per parent, parents in key order. The write waits for the parent's row like any update
   of it, and that wait is what makes the number exact: whoever commits second adds to what the first one left.
   Two statements that touch the same parents ask for them in the same order, so a cascade from a deleted track
   that leaves three playlists cannot deadlock with another one. The update trigger cannot name columns (a trigger
   with transition tables may not), so it runs on every update of the counted table and writes nothing when
   neither the relation nor a field of `where` changed. A control in the test writes the same increments from a
   value read before the row was held, and the counts come out short.
2. **Counts on an ordered table: an append takes the parent the way a move does. Departure** from the
   recommendation, which was to take no lock the order holds in the other order. The order's lock is the parent's
   row, taken before any row of the parent; a count writes that same row after the row that changed, in every
   writer that starts from a row (a plain DELETE, a cascade from the far side of a junction, an update). A count
   that did not wait for the parent there could only be right "at the parent's next write", which round B2
   accepted for a gap in the places and which is not acceptable for a number a page shows. So the count waits, and
   what closes the cycle is on the other side: on a table that is ordered within the relation it is counted by, a
   `BEFORE INSERT` trigger of the count's (it fires before the order's own, by name) takes the rows the new row's
   foreign keys point at (key share, what the keys take anyway), then the parent and every row of it without
   waiting, exactly as `move` and `remove` do through `osl_hold_<table>`. Whoever holds the parent then holds its
   rows too, and no count waits for a parent whose rows are half taken. Cost: an append on such a table locks the
   parent's rows (as many row locks as the parent has rows) and is retried like a move when one of them is held.
   Proof: round B2's load runs a second time in `order.database.test.ts` with a count of the list's entries in
   place, and at 400 writes per connection (three seeds) no writer fails and every count is exact. Two controls,
   run as scratch scripts on the same load: without the hold, a transaction that appends and then moves waits ten
   seconds for a row whose writer waits for the count, and fails (24 of them in 960 writes, with deadlocks among
   the others); without the key shares first, an append holding the parent deadlocks with the cascade that deletes
   the row it points at (3 in 3600 writes).
3. **What a count cannot order, and PostgreSQL ends by failing one side.** Every writer of a counted row holds that
   row first and asks for the counting row second. A writer that holds the counting row first and then asks for a
   counted row runs against them: a delete of the counting row (its counted rows go by cascade) racing a delete or
   an update of one of them, which two generated requests can do (`DELETE /posts/1` and `DELETE /comments/5`); and
   a transaction of the user's own that writes a counted row and then another row of the same parent, where the
   rows are not ordered. PostgreSQL detects the cycle after a second and fails one of the two with
   `deadlock_detected`, which every backend answers as a 500 today; nothing is lost and the count stays exact. The
   test's second load has both and allows that one failure. Closing the first case would need the generated
   delete to take the counting rows before the row it deletes, which is a function per counted table and was left
   out of this round.
4. **Under `isolation: database` the count's functions are `SECURITY DEFINER`.** A trigger on a tenant table runs as
   the statement's role, under the policies. Between two tenant tables that would do: the composite keys of round
   B1 put the counted row and the counting row in one tenant, and the caller who may write the one is bound to the
   tenant of the other. It would not do in the two other cases, and a count must not depend on who writes. A
   shared table's row counted on a tenant's row (a relation that is optional, so the table stays shared, M116) is
   written by callers who are not bound to that tenant: under the caller's rights the policy hides the counting
   row from the count's own write, and the number is wrong without a word. And on an ordered table the count calls
   the order's `hold`, which nobody but the owner may. The functions read nothing and return nothing; they add to
   the count of exactly the rows the statement's own rows point at, and `EXECUTE` is revoked from everyone. So a
   count is no way to learn about a row: what a caller can learn is the number itself, by reading the counting
   row, which the read rule and the policy of that row decide. That number is by design a fact about the counting
   row whatever the rules of the counted rows say; the reference says not to count rows whose number the row's
   readers may not know. A count on a shared row over a tenant table adds up every tenant's rows, and M156 warns
   at apply (workspace: `User.team_count`).
5. **`archive` and `restore` are the compiler's actions, by round B2's mechanism. Departure** from the design's
   `kind: "archive" | "restore"`, as recommended. `ActionIR.builtin` is `"move" | "archive" | "restore"`, so routes,
   the tRPC procedures, validation, OpenAPI, the web client, scenario steps, the walks, `osl implement` and the eval
   runner treat them as they treat `move`, and `userActions(ir)` leaves them out wherever a handler file is meant.
6. **The archive field is added when the model is parsed, and written back.** `archive: true` on an entity without
   the field gives it `archived_at: { type: datetime, read_only: true }` in the parsed model, so `model.yaml` spells
   it out and everything that reads a model (rules with `when archived_at = null`, page columns, `where` of a
   count, the ops that rename and remove fields) sees an ordinary field. A new op `set_archive` sets or ends the
   archive of an entity that exists; ending it leaves the field. The alternative, a column only the IR knows, would
   have needed every reader of `entity.fields` to learn about it.
7. **The workspace proof is on Milestone and Label, not on Project** (as recommended). Project already archives by
   hand with a status enum and rules that test it (WS-4); `archive: true` beside it would put two notions of
   archived on one entity, and replacing it would move the expectations of an applied scenario. Milestone is
   ordered and hidden as not found, Label is the far side of a relation through a junction, so the two answer the
   questions below. No applied intent was edited and no earlier scenario's expectation moved.
8. **An include is not a list: an archived row still comes in an include.** A task shows its archived project, a
   project's included milestones include the archived ones, and a milestone still names an archived label it
   carries through the junction; each carries its `archived_at`. Only a resource's own list filters. Reason: a row
   that hid what it points at would look broken, a parent that hid archived children would disagree with a count
   over them, and one rule is easier to hold than three. A client that wants the live children lists them.
9. **An archived row keeps its place.** Archive does not touch a `position`: the places of a parent are numbered
   over all its rows, a move counts archived rows as it counts the others, and the live list shows the places it
   has (1 and 3 when 2 is archived). `?archived=true` lists in the same order as the plain list. The alternative,
   taking the row out of the order, would need a place to give it back on restore.
10. **A count without `where` counts archived rows; the model says otherwise in `where`.** A count whose
    condition names the archive field (`where: "done = false and archived_at = null"`, the open ones) falls on
    archive and rises on restore, because the trigger reads the row. `where` is a conjunction of comparisons on
    the counted entity's own fields; `or` and paths through relations are not in it.
11. **Nothing changes in the policies of round B1.** Archive is a condition the handlers add to a list, not a
    policy: the tenant policy and the public-read policy are what they were, and the walk's unbound probe reads
    the same rows it read (the 2 a public read rule opens, of 119 now).
12. **409 comes from one conditional update.** The handler sets `archived_at` where the id matches and
    `archived_at IS NULL`, returning the row; no row back is "nothing to do". Two callers at once cannot both
    archive a row, and a handler never assumes the row came back.
13. **Events follow archive and restore; a timer cannot run them. Departure** from the design, which had timers run
    them. A timer runs an action's handler as the system, and these have none; M133 says to declare a row action
    whose handler sets the field. A timer may wait on `archived_at` (the "kept for thirty days, then purged" ask):
    archive and restore schedule the entity's timers as an update does.
    Round B4 (2026-11-10) lifted this for every row action the compiler writes as one statement: a timer runs
    `archive`, `restore` and a transition as the system (`state-machines.md`, decision 2), and the statement moved
    from each resource module into one generated module that handlers and timers both call.
14. **`archived` is the list's own parameter, a tile's and a page's filter key, and nothing else's.** A scenario
    writes it as a string (`query: { archived: "true" }`), like every query value; a tile and a fixed page filter
    write `archived: true` without a list filter behind it; a field named `archived` in `list.filters` of an
    archiving entity is M157.
15. **The harness predicts both.** The rule walk's evaluator leaves an archived row out of the list it predicts,
    expects 200 from `archive` on a live row and 409 on an archived one (and the reverse for `restore`), and after
    each one that went through reads the caller's two lists and looks for the row where its state puts it. Both the
    rule walk and the order walk end by comparing every count of the model with the rows the database holds.
16. **The migration that adds a count counts.** `UPDATE <table> SET <count> = (SELECT count(*) ...)`, one statement
    per count, when the field arrives on a table that exists or when what it counts changes; listed as a table
    rewrite. A renamed field of `where` follows without counting again.
17. **Diagnostics M150 to M157**, the round's block: M150 the archive field is not a server-owned nullable
    datetime; M151 a declared action named `archive` or `restore` on an archiving entity; M152 (warning) archive on
    the identity, the tenant or the membership; M153 `count_of` does not name a reverse relation to count (none, a
    one-to-one, a relation through a junction, a composite key); M154 a condition of `where` does not fit the
    counted entity; M155 (warning) `read_only: false` or `required: false` on a count; M156 (warning) a count on a
    shared row over a tenant table; M157 a list filter named `archived` on an archiving entity. A count in a
    resource's write fields is the existing M064, a timer that runs archive the existing M133.
18. **Intents WS-13 and FEAT-13**, the next free numbers; the design named FEAT-15.
19. **Eval corpus.** The four cases based on the whole blog fixture are pinned `through: FEAT-12`, the model they
    were written against. Three asks the construct now answers expect it (`archive: [Article]`), two asks are new,
    and `archive` and `counts` are new expectation keys.

## Mapping

- Core: `Entity.archive?: true | { field?, rule? }`, `Field.count_of?: <reverse relation>`, `Field.where?`, the op
  `set_archive`. The IR carries `EntityIR.archive` (the column and the rule), `EntityIR.counts` (per count: the
  counted table, its relation column, the conditions, the names of the function and the triggers, and `hold` when
  the counted table is ordered within that relation), `ColumnIR.count`, and the two actions with
  `builtin: "archive" | "restore"`. `countObjects(ir)` renders the functions and triggers; `databaseObjects(ir)` is
  the one list of the isolation layer's objects, the ordered collections' and the counts', which `planMigration`
  plans and drops together and the drift check compares. `planMigration` adds `backfill_count`.
- drizzle-next and hono-trpc-vite: the list's condition and the `archived` parameter (a boolean in tRPC,
  `"true" | "false"` in a query string); one module-level `setArchived(row, archived)` behind the two handlers;
  the switch, the muted rows and the two buttons in the pages. No code for counts beyond the column.
- gin-pgx: the same condition (`archived` parses like a boolean filter) and the same conditional update in the
  action's handler; no code for counts.
- OpenAPI: `archived` as a boolean query parameter on list; the actions; the count as a read-only integer.
- Reference: a paragraph for Archive and one for Counts, with the rule for choosing: "removed but recoverable" is
  `archive`; "how many related rows" is `count_of`; a sum is not expressible.

## Under `isolation: database`

| Piece                                   | What it is under the policy                                                                                                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archived_at`                           | a column of the entity's table like any other; the tenant policy decides who reaches the row, archived or not                                                                                                                      |
| the list condition                      | added by the handler beside the rule's own filter; no policy reads it                                                                                                                                                              |
| `archive`, `restore`                    | an update of the row by the app role in the request's transaction, under the tenant policy; the archive's own rule is compiled with the membership of the row's tenant, like every rule of a tenant table (decision 2 of round B1) |
| the count's function                    | `SECURITY DEFINER`, owned by the migrating role, `EXECUTE` revoked from everyone; reads nothing, returns nothing                                                                                                                   |
| a tenant's rows counted on a tenant row | the same tenant, by the composite keys; written whoever is bound                                                                                                                                                                   |
| a tenant's rows counted on a shared row | the number adds up every tenant's rows, and whoever reads the shared row reads it (M156)                                                                                                                                           |
| a shared table's rows on a tenant's row | written although the caller is not bound to the tenant; the caller reads no such row and learns nothing from the write                                                                                                             |
| the hold before an append               | `SECURITY DEFINER`, so that it may call the order's `osl_hold_<table>`, which is nobody's to call                                                                                                                                  |
| the backfill                            | run by the migrating role, which the policies do not bind (row security is enabled, not forced)                                                                                                                                    |
| drift                                   | compares the functions (body and definer rights) and the triggers with the live database, with the isolation layer's and the order's                                                                                               |

Proven three ways: the workspace fixture as a non-superuser owner (WS-13's scenario has a user in two teams counted
as two for a caller of only one of them, and the walks compare every count with its rows after every create,
update, action, burst and delete); `count.database.test.ts` as the app role with the right tenant, another one and
none bound, with a control that gives the function the caller's rights and finds the count short; and the unit
tests of the rendered objects.

## Declined, with the sentence the reference gets

- `sum_of`, `avg_of`, `max_of`: the same trigger shape would serve, but each needs a numeric type and a null
  policy; left for a round that asks for it twice. "A total is a `read_only` field a handler keeps."
- Cascading archive (archiving a project archives its tasks): "archive is per row; an event handler on
  `projects.archive` may archive the children".
- Listing archived and live rows together: `?archived=true` answers archived only; a client that wants both calls
  twice. One parameter, two states.
- A count across a path (comments of a project's posts), or through a junction's far side: one relation hop; "count
  the junction's rows".
- A count per viewer (unread for me) and a count grouped by a value (reactions per emoji): not a column of the row.
- A timer that runs `archive` or `restore`: "declare a row action whose handler sets the field and run that".
  (Built in round B4; the reference no longer says this.)
- Archived rows left out of includes: "an include is not a list".

## Proof

- Fixtures: workspace WS-13 "archived milestones and labels, and what a project counts": `Milestone` with
  `archive: { rule: "member:project_id.team_id:admin" }`, `Label` with `archive: true`, `Project.milestone_count`
  and `Project.open_milestones` (`where: "done = false and archived_at = null"`), `User.team_count`. The scenario
  creates milestones (both counts rise), marks one done (the open count falls), a member archives one (403), an
  outsider (404), nobody signed in (401), an admin (200) and again (409); the list loses it and keeps the places 1
  and 3, `?archived=true` finds it, the plain count stays and the open one falls, a move still counts it, a member
  restores it (403), the admin (200) and again (409); a delete lowers both counts; an archived label leaves the
  label list and is still named on its milestone; a user added to two teams counts two for a member of one. Blog
  FEAT-13 "comment counts and archived articles": `Article.comment_count` in `sortable`, `Article` with
  `archive: { rule: "owner:author_id" }` and a queued event on `posts.archive`, `User.post_count`
  (`where: "published = true and archived_at = null"`), a tile of archived articles; the scenario sorts by the
  count both ways, lowers it with a delete, raises `post_count` through the user's own publish handler, and lowers
  and raises it again with archive and restore.
- Database tests: `count.database.test.ts` (24 connections of inserts, deletes, updates of the condition's field,
  moves between parents and statements over several parents; a second load with deletes of the counting row and
  the user's own transactions, where only `deadlock_detected` may fail; TRUNCATE; the control; a count that
  arrives on a table with rows, is counted again when its condition changes and is found by the drift check; the
  isolation case with its control) and `order.database.test.ts` run twice, the second time with a count on the
  ordered table.
- Eval cases: `fx-ws-13-archive-and-counts`, `fx-blog-13-comment-counts`, and the asks `empty-forum-reply-counts`
  and `empty-docs-archive`. The design named "the r6 comment-count ask promoted"; no such case is in the
  repository, so the forum ask was written instead.
- Gate: as every round, then `built` for "soft delete and archiving" and a note on "computed and aggregate
  fields" that counts are built and sums remain open.

## Size

Core: two field keys, one entity key, one op, two built-in actions, a new module of database objects with its
backfill step, eight diagnostics, the reference. The list condition and one function behind two handlers per
backend, the switch in the two web backends, two additions to the walks. About the size of the hidden-rows round
in the backends and of the ordering round's database half in core; the tests against a real database are the
larger part.

## What it leaves open

- A delete of a counting row against a write of one of its counted rows ends in PostgreSQL's deadlock detection
  (decision 3); the generated delete could take the counting rows first.
- `deadlock_detected` and `lock_not_available` answer 500 on every backend.
- No browser drove the switch and the two buttons; both web apps type-check and build with them.
- A timer on `archived_at` is scheduled by archive on all three backends (the blog fixture's Article has a timer,
  so the call is generated and runs), but no scenario waits on one.
- Sums and the other aggregates; a count per viewer.
