# Design: archiving, and counts over relations

**Status: proposed 2026-11-09.** Not yet built. Two constructs that share a proof. The grammar below is the design
to review before the build.

Soft delete is the most repeated hand-written pattern in applications of OSL's shape. One of the two surveyed for
these notes carries an `is_active` flag on 182 tables; the other carries `archived_at` or `deleted_at` on every
user-facing entity with an archive and an unarchive procedure each, and every list query remembers, or forgets, the
filter. Denormalized counts come second: votes, replies, occurrences, items on hand, kept by hand-placed
increments or by a trigger, and read by every list and tile. Agents ask for both: "archived rows" under the rules
topics, counts under "computed and aggregate fields".

## What was asked, in the agents' words

| Ask                                                                                                                                                               | Where                                | Verdict                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| "Archiving a project takes it out of the way: members no longer see it or edit it, while the team's admins still see it and may edit it, to rename or restore it" | `fx-ws-4-archived-projects` (corpus) | expressible today by hand; construct: `archive`      |
| "A team admin can archive a project. An archived project shows when it was archived. Nobody sets or clears that by editing the project"                           | `ws2-archive-project` (corpus)       | construct                                            |
| "Projects can be archived with one operation. The dashboard shows how many projects are archived"                                                                 | `todo4-archive-projects` (corpus)    | construct, with the tile filter `archived: true`     |
| "Authors can archive one of their articles, which marks it archived and records when. Archiving notifies in the background"                                       | `blog5-archive-action` (corpus)      | construct, with a queued event on `articles.archive` |
| "Track how many times each post has been viewed ... the count is part of the post"                                                                                | `blog2-view-counter` (corpus)        | a handler today; `count_of` over a View entity       |
| "Anyone can see how many likes a post has by listing them per post"                                                                                               | `blog2-likes` (corpus)               | `page.total` today; `count_of` makes it a column     |
| "The total estimated hours still open, broken down by project"                                                                                                    | `gen-r7-09-admin-overview-dashboard` | not delivered: sums, declined below                  |

Archiving is expressible today, and workspace WS-4 does it: a `read_only` `archived_at`, an action whose handler
sets it, and `when archived_at = null` repeated on every rule members use. The construct keeps that contract and
removes the handler, the condition on every rule, the restore nobody writes, and the list parameter every client
reinvents.

## 1. Archive

```yaml
entities:
  Project:
    archive: true # or { field: archived_at, rule: "member:team_id:admin" }
```

`archive: true` adds a `read_only` nullable datetime `archived_at` (or names an existing one), and:

- Lists over the entity carry `archived_at IS NULL` unless the client asks `?archived=true`, which answers only
  archived rows the rules allow. Get answers an archived row as any other. Dashboard tiles count live rows unless
  their filter says `archived: true`.
- Row actions `archive` and `restore` on every resource over the entity, under the entity's update rule or the
  `rule` given; `archive` on an archived row and `restore` on a live one answer 409. Events follow them
  (`on: projects.archive`), timers may run them, and a timer on `archived_at` with `after: 30d` running a declared
  `purge` action is the "kept for thirty days" ask.
- Delete is unchanged: an entity may have both, or set `delete: none` to make archiving the only way out, which is
  what the reference recommends when the ask says "removed" but a restore is wanted.
- Pages: resource pages gain a "Show archived" toggle beside the list filters, archived rows render muted with a
  Restore action in the detail pane, and the New and Edit forms are unaffected.

## 2. Counts over relations

```yaml
entities:
  Post:
    fields:
      comment_count: { type: integer, count_of: comments, where: "approved = true" } # comments: a reverse relation declared on Comment.post_id
```

A `read_only` integer the database keeps: a trigger on the related table (insert, delete, and update of the
relation field or of a field named in `where`) adjusts the count, and the migration that adds the field backfills
it. `where` takes the rules' row-condition spelling on fields of the related entity. The field is filterable,
sortable and usable in tile filters like any integer, and it is correct under concurrency without a handler.

Why a trigger rather than a subquery or a handler: one mapping serves all three backends, lists sort on a plain
column, and the count survives a handler the model wrote forgetting it.

## Mapping

- Core: `Entity.archive?: true | { field?, rule? }`, `Field.count_of?: <reverse relation>`, `Field.where?`. The IR
  marks the archive field and emits the two actions as `ActionIR` with `kind: "archive" | "restore"`; the count
  becomes a `ColumnIR` with `maintained: { table, fk, where }`. `planMigration` emits the trigger function and the
  triggers, the backfill `UPDATE ... SET count = (SELECT count(*) ...)`, and drops them with the field. Diagnostics:
  `archive` on the identity or the tenant entity (allowed, with a warning that memberships are not archived), a
  declared action named `archive` or `restore`, `count_of` naming something that is not a reverse relation of this
  entity, `where` naming a field the related entity lacks, `count_of` without `read_only` (implied; a warning if
  spelled otherwise).
- drizzle-next and hono-trpc-vite: the list query gains the archive predicate and the `archived` query parameter;
  the two actions are generated handlers like transitions; the pages get the toggle and the muted row state. No
  code for counts beyond the column.
- gin-pgx: the same predicate and handlers; no code for counts.
- OpenAPI: `archived` as a boolean query parameter on list; the actions; the count as a read-only integer.
- Reference: a paragraph under Entity for archive and one under Field for `count_of`, with the rule for choosing:
  "removed but recoverable" is `archive`; "how many related rows" is `count_of`; a sum is not expressible.

## Declined, with the sentence the reference gets

- `sum_of`, `avg_of`, `max_of`: the same trigger shape would serve, but each needs a numeric type and a null
  policy; left for a round that asks for it twice. "A total is a `read_only` field a handler keeps."
- Cascading archive (archiving a project archives its tasks): "archive is per row; an event handler on
  `projects.archive` may archive the children".
- Listing archived and live rows together: `?archived=true` answers archived only; a client that wants both calls
  twice. One parameter, two states.
- A count across a path (comments of a project's posts): one relation hop in this version.

## Proof

- Fixtures: workspace WS-13 "archived projects": `Project` with `archive: true`, `Task.count` on Project as
  `count_of: tasks` with `where: "done = false"`, a scenario that creates tasks (count rises), marks one done
  (count falls), archives the project (the list loses it, `?archived=true` finds it, the tile shows one fewer), a
  member restores it (403 under the admin rule), the admin restores it (200), a second restore (409). Blog FEAT-15
  "comment counts": `Post.comment_count`, sorted lists, a delete that lowers it.
- Eval cases: `fx-ws-13-archived-projects`, `fx-blog-15-comment-counts`, and the r6 comment-count ask promoted.
- Gate: as every round, then `built` for "soft delete and archiving" and a note on "computed and aggregate
  fields" that counts are built and sums remain open.

## Size

Core: two keys, two action kinds, the trigger and backfill steps in migrations, six diagnostics, the reference.
The list predicate and two handlers per backend, the toggle in the two web backends. Smaller than the scheduling
round; counts are almost entirely migrations.
