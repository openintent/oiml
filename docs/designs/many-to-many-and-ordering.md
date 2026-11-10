# Design: many-to-many relations and ordered collections

**Status: built 2026-11-10** (round B2 of the road to 1.0.0). Written and built in one round, without a design
review stop, so every decision is the owner's to review; they are numbered under "Decisions" and the ones that
departed from what the round was asked to consider say so. What changed from the first design while building:
the order's concurrency went through three shapes, and a test against a real database refused the first two.
The first took the parent's lock and renumbered in every writer, with the delete trigger skipping when the lock
was held; 24 connections found a deadlock between two cascades that each renumbered a list the other had rows in.
The second made move and remove take every row of the parent without waiting; a heavier run found a deadlock
between an append that had renumbered (holding the parent's rows) and a cascade holding the row the append's own
foreign key check was waiting for. The third is what is built: an append takes no row but the parent's, so no
writer waits for a row while it holds rows of the parent. The other changes: a junction that declares its tenant
has three relation fields, so `to` is needed there (the workspace fixture uses it); the list order check of the new
walk applies only where the resource lists in the entity's own order; a position added to an entity that exists
takes its parent field out of update, which the contract walk reports as a breaking change (workspace WS-12,
`milestones.update` loses `project_id`). Proof: a fourth fixture, `music` (MU-1 to MU-4, 74 scenario steps), and
workspace WS-12 under `isolation: database` (31 steps), conformance 12/12 with six walks, 160 unit tests with the
database (156 and 4 skipped without), the oracle gate 32/32. Since then: the hardening pass of 2026-11-10 made
the `lock_not_available` of a move or a remove that gives up a 503 `busy` with `Retry-After: 1` on every backend,
where "What it leaves open" below says 500.

Two gaps, one proof. A list could not include a row reached through a junction, so a track's genres and a course's
instructors showed as ids where names were wanted; and a position within a parent was a plain integer that a
handler had to renumber, with no drag in the pages and no answer to two writers at once. Both were asked for by a
round once and by two exercises each, and one fixture proves them together, because a playlist's tracks are both: a
junction, in an order.

## What was asked, in the rounds' and the exercises' words

| Ask                                                                                                        | Where                               | Verdict                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| "A course shows its instructors' names" (course, course_instructors, user)                                 | round 6, one case                   | construct: a relation through the junction                                                 |
| "A track has featured artists and genres"                                                                  | Spotify SP-3                        | construct: a relation through each junction                                                |
| "Albums hold tracks in order"                                                                              | Spotify SP-3                        | construct: a position within the album                                                     |
| "A listener adds tracks in an order they can change"                                                       | Spotify SP-5                        | both: the entry is a junction with a position, the playlist's tracks a relation through it |
| "Playlist tracks with a position; create appends, a move renumbers, delete closes the gap, the page drags" | round 5, one case; the backlog note | construct                                                                                  |
| "A page is an ordered list of blocks"                                                                      | Notion NO-3                         | construct, for the blocks of a page                                                        |
| "Blocks nest under toggles and lists and move within and between pages"                                    | Notion NO-3                         | declined below: an order within a nullable self-relation, a move between parents           |
| "A place among its siblings" for a page in a tree                                                          | Notion NO-2                         | declined below, with tree queries                                                          |
| "Breadcrumbs show its ancestors"; "a move that would make a page its own descendant"                       | Notion NO-2                         | not this: tree queries, in the 1.1 table                                                   |
| "Reactions, pins, user groups"                                                                             | Slack SL-6, SL-7                    | already junctions; a group's members by name is the relation through it                    |

## The constructs

```yaml
entities:
  Track:
    fields:
      id: { type: uuid, primary: true }
      album_id: { type: uuid, required: true, relation: { entity: Album, reverse: tracks, on_delete: cascade } }
      title: { type: string, required: true }
      track_number: { type: integer, position: { within: album_id } } # the server's: 1 for the first track of an album
    relations:
      genres: { through: TrackGenre } # the Genre rows TrackGenre links this track to
  TrackGenre: # the junction stays an entity: its rules, its resource, its fields
    fields:
      id: { type: uuid, primary: true }
      track_id: { type: uuid, required: true, relation: { entity: Track, on_delete: cascade } }
      genre_id: { type: uuid, required: true, relation: { entity: Genre, on_delete: cascade } }
    unique: [[track_id, genre_id]]
    rules:
      {
        read: public,
        create: "owner:track_id.album_id.artist_id.owner_id",
        update: none,
        delete: "owner:track_id.album_id.artist_id.owner_id"
      }
resources:
  tracks:
    entity: Track
    operations: [list, get, create, update, delete] # and POST /api/tracks/{id}/move { to }, which nobody declares
    list: { filters: [album_id], include: [album, genres] }
    get: { include: [album, genres] }
  track_genres: { entity: TrackGenre, operations: [list, get, create, delete], list: { filters: [track_id, genre_id] } }
```

- `Entity.relations: { <name>: { through: <Junction>, from?, to? } }`. `from` and `to` are the junction's two
  relation fields, inferred when the junction has exactly one relation field to the entity and one other; named
  otherwise (two relations to one entity, or a third relation such as the tenant's). The op for an entity that
  exists is `set_relations { entity, relations }`, which replaces the block like `set_rules` and `set_indexes`.
- `Field.position: { within: <field> }` on an integer field. `within` is a required many-to-one relation field to
  another entity. At most one per entity, and the entity has a single-column key.
- `move` is not declared. A resource over an entity with a position field has the row action
  `POST <resource>/{id}/move` with `{ to: integer >= 1 }`, under the entity's update rule, answering the row.

## Decisions

Each with its reason. "Departure" marks where the round did something other than what it was asked to consider.

1. **The junction stays a declared entity; no compiler-made junction tables.** As recommended. Its rules, its
   resource and what a link carries (a position, an added-at stamp, a role) are the model's to state, round A2's
   membership relations already read a junction through a reverse relation, and nothing in the evidence needs a
   table the model cannot see. So there is nothing new to say about a made table's rules or its tenant.
2. **The relation is declared on the entity, under `relations`, and resolved against the junction.** One line per
   side that shows the far rows. The alternative, a key on the junction's relation field, would have put a
   track's relation in the junction's file and needed two keys for the two sides.
3. **An include returns the far rows themselves** (`genres: [{ id, name }]`), not junction rows with the far row
   nested. That is the ask ("names where ids were"), and what a link carries beyond the pair is read where it
   lives: the junction's own list, filtered by the near field, with `include: [track]`, which worked before the
   round and is ordered by it now.
4. **A link is written through the junction's resource; the parent's create and update take no `genre_ids`.**
   Departure from the Spotify sketch ("create and update accept `artist_ids`, written in the transaction"). One
   way to write a row: the junction's create and delete rules, its hooks, its events, its position and its unique
   pair apply as written, and no backend gains a second place where a rule is evaluated for rows of another
   entity. The cost is one request per link, and a new row is created before its links.
5. **Far rows come in the junction's order when it has a position within the near field, by their display column
   otherwise.** A playlist's tracks are in the listener's order; a track's genres are alphabetical, the same on
   every run and every backend.
6. **A far row is returned whatever its own read rule says.** Every include does that today (logged in the
   hidden-rows note). The reference says not to include rows the reader may not see. Under `isolation: database`
   the policy still applies to the far table.
7. **The order is a key on a field: `position: { within }`.** The field keeps its own name (`track_number`,
   `position`), filters and `list.order` name it like any column, and no field type is added (a sixteenth type
   would touch every type table of three backends for one integer). An entity-level key that made the column
   itself was the other option; a column the model does not show is what B1 had to do and nothing here needs.
8. **The scope is a required relation to another entity.** The order hangs on one lock, the parent's row. An order
   over a whole table, within an optional relation, or within the entity's own rows has no such row. Notion's
   nested blocks (`within: parent_block_id`, falling back to `page_id`) did not fall out cheaply and are declined
   with tree queries; a page's top-level blocks are `within: page_id` today.
9. **`move` takes a place, `{ to }`, clamped to the end.** A place is what a drop target and a scenario know, and
   clamping means a client that counted a stale list still gets a right answer, never a failure it did not earn.
   Below 1 is a 400. Declined: before and after another row, which needs a second id and its own refusals.
10. **`move` is the compiler's and implicit**, under the entity's update rule, the default every row action has.
    `update: none` leaves no move. A user action named `move` on such a resource is M143. It is an action in the IR
    (`builtin: "move"`), so routes, procedures, validation, OpenAPI, the web client, scenario steps and the walks
    came with it; only the handler call differs. It runs no hooks and emits no event.
11. **Places are 1..n and a delete closes the gap.** The exercise's sketch, and what a track number is. Through the
    API always. A row that leaves by a cascade from elsewhere (a track deleted from the catalog leaves every
    playlist) closes its gap at once when nothing else is writing that parent, and otherwise at that parent's next
    move or delete; places are unique and in order at every moment either way. This is the one place the dense
    numbering is not immediate, and the reference says so.
12. **The order lives in the database.** A deferrable unique constraint, a trigger that appends, a trigger that
    closes gaps, and `osl_move_<table>` and `osl_remove_<table>` that the handlers call. Reason: a cascade is not a
    handler. The entry of a deleted track leaves a playlist without any generated code running, and so does a row a
    user's action handler inserts. B1 set the precedent (a trigger keeps the derived tenant column) and B3's counts
    will follow it.
13. **Concurrency: one lock per parent, and no writer waits for a row while holding rows of that parent.** Append,
    move and remove wait for the parent's row (`FOR NO KEY UPDATE`, which does not block other tables' inserts
    under the same parent). Move and remove then take every row of the parent `NOWAIT`, and on a held row give
    everything back and ask again, for about ten seconds. Append takes no row. The trigger after a delete takes
    the parent and its rows only if free. The unique constraint is deferrable so that one statement renumbers.
    Sparse ranks were the alternative: a move writes one row, but the place a client reads becomes a window
    function on every read path of three backends, and two moves into one gap still need a tie-break.
14. **A row keeps its parent.** The `within` field leaves update. A move to another parent is delete and create.
    Adding a position to an entity that exists is therefore a breaking change to its update input, which the
    contract walk reports and the op explains.
15. **Create always appends.** The field is refused in create like any read-only field. "Insert third" is create,
    then move.
16. **A list's default order on an ordered entity is parent, then place**; a declared `list.order` wins. A reverse
    include of the parent comes in place order.
17. **The pages edit a relation in the detail pane, not in the form.** Departure from "in the form". The pane's
    row for the relation is its editor: names with a remove control, a select that adds, drag (and arrows) to
    reorder. Each is its own request to the junction's resource under the junction's rules, and the create form has
    no row to link yet. The controls are offered by the parent row's owner where the junction's rule is one step
    from it (`owner:playlist_id.owner_id`), and to any signed-in user where the rule goes deeper; the API decides.
18. **Diagnostics: M014 and M015 in the relations family (M010 to M013), M140 to M144 in the round's block.** M014
    a relation whose junction does not link the two sides unambiguously, M015 a name a field or relation has, M140
    `within` is not a required relation to another entity, M141 two positions, M142 a composite key, M143 `move`
    declared by hand, M144 the parent field in `update.fields`. A position in `create.fields` is M064, with its own
    sentence.
19. **The `music` fixture has no tenancy.** Departure from the exercise, which makes Artist the tenancy entity. Under
    B1 every alternative that needs a session also needs membership of the row's tenant, and a playlist entry with a
    required relation to a track would be the artist's tenant row, which no listener could write. The constructs
    need owners, not teams. Isolation is proven where it already is on: workspace WS-12.
20. **M115 stays as B1 built it.** A junction between two tenant tables declares its own required relation to the
    tenant. Deriving the tenant through the first of two relations would have changed a diagnostic B1 tests.
21. **A sixth walk, `order`**, rather than scenario steps, proves the concurrency on every backend: a scenario is
    sequential by construction.

## The mapping

| Piece          | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model          | `Field.position`, `Entity.relations`, `positionOf`, `throughRelation`, `hasMoveAction`; `relationNamesOf` includes the relations through a junction; `resolveStepOp` knows `<resource>.move`; `set_relations`; renames of entities and fields follow `through`, `from`, `to` and `within`, and removing what one stands on is refused                                                                                                           |
| IR             | all optional, so a model without the constructs compiles to the IR it had: `ColumnIR.position` (not null, read-only, default 0), `EntityIR.order` and `EntityIR.through`, `RelationIR.orderBy` on a reverse relation through the `within` field, `through` on list and get beside `include`, `ActionIR.builtin`, `PageIR.relations`; `userActions(ir)` is every action a handler of the user's answers                                          |
| Database       | `orderObjects(ir)` in `packages/core/src/order.ts`: the constraint, five functions and two triggers per ordered entity, planned and dropped with the isolation layer's objects; a `backfill_position` step numbers the rows of a table that gains a position (by `created_at` when it has one, then the key) before the constraint arrives; drift compares the functions and triggers                                                           |
| drizzle-next   | `load<Relation>(ids)`, `attachList`, `attachGet` in the resource module; `with: { tracks: { orderBy } }`; the move handler calls `moveRow` (the function, then the row read again); delete calls `osl_remove_<table>`                                                                                                                                                                                                                           |
| hono-trpc-vite | the same from the shared generator (`packages/ts-common/src/ordering.ts`); `move` is a tRPC mutation                                                                                                                                                                                                                                                                                                                                            |
| gin-pgx        | `load<Relation>` on the handler (the links in order, then the far rows); the reverse loader's `ORDER BY`; `ActionMove` calls the function and scans the row again; delete calls the function                                                                                                                                                                                                                                                   |
| Web            | both TypeScript backends, from `packages/ts-common/src/web`: a page column that names a relation shows the far rows' names; the detail pane has a component per relation it includes (`OrderedList`, `NameChips`, `AddPicker` in the generated `ui.tsx`, present only when the model has the constructs); the children of an ordered entity (an album's tracks) are dragged in the parent's pane; `move` also shows as a row action with a form |
| OpenAPI        | the far rows as an array property of the list and get responses; `move` as a path                                                                                                                                                                                                                                                                                                                                                               |
| Harness        | the `order` walk; nothing else: the rule, tenant, fuzz and leak walks reached `move` and the new includes through the IR                                                                                                                                                                                                                                                                                                                        |
| Evals          | expectation keys `through` and `ordered`; `fx-mu-1-catalog`, `fx-mu-2-genres`, `fx-mu-3-playlists`, `fx-ws-12-milestone-order`; the asks `empty-course-instructors` (the round 6 case) and `empty-checklist-order`                                                                                                                                                                                                                              |
| Reference      | two paragraphs after the junction sentence ("Many-to-many goes through a junction entity you declare", "Ordered collections"), the ops line, the Entity and Field keys, the include sentence, the App paragraph; `docs/model.md` says the same                                                                                                                                                                                                  |

## Under `isolation: database`

- **A junction is a tenant table like any other.** With one required relation to a tenant table (TrackGenre, where
  Genre is shared) its tenant is derived through it. Between two tenant tables it declares its own required
  relation to the tenant (M115, unchanged): a link names the tenant, its rule is a member rule on that field, and
  B1's composite keys hold both ends to it, so a label of another team on a milestone is refused by the database
  (a 400) even where the rules would let a member of both teams through. Such a junction has three relation
  fields, so the relation through it names `to`.
- **Whose tenant a row of a junction belongs to:** the tenant of the row it is required to point at; both, when it
  points at two. A junction from a shared row to a tenant row (a listener's playlist entry to an artist's track)
  is the tenant row's tenant's, which is why the music fixture has no tenancy (decision 19).
- **The far rows of an include** are read in the request's transaction, under the policy: another tenant's far row
  is not returned, whatever the junction says.
- **The order's functions are `SECURITY DEFINER`.** A place is counted among every row of the parent, and under
  the policy a caller would count only its own tenants' rows of a parent that several tenants share. They touch
  one column. `osl_move_<table>` and `osl_remove_<table>` test the row they are given against the tenant policy's
  own expression before anything else (`AND team_id = ANY (the bound tenants)`), and answer as for a missing row
  when it fails, so the backstop holds for them as for a plain statement: the tenant walk's second pass, with the
  rule checks off, runs `move` as an outsider and is refused. They are granted to the app role; the trigger
  functions and the lock helper are granted to nobody.
- **The triggers** run inside the statement that fired them. The insert's own policy check (`WITH CHECK`) and B1's
  tenant trigger are unchanged and independent: one sets the place, the other the tenant.
- **`move` in the IR** is the update rule narrowed like every rule of a tenant table (`... and member:<tenant>`).

## What is declined, with the sentence the reference gets

- `genre_ids` on the parent: "A link is a row of the junction, written through the junction's resource, one request
  each: the parent's create and update take no `genre_ids`."
- A list filtered by a far row: "a list is not filtered by a far row (the tracks of a genre are `genres.get` with
  `include: [tracks]`, or the junction's list filtered by `genre_id` with `include: [track]`)."
- Checking a far row's read rule: "A far row is returned whatever its own read rule says, like every included row:
  do not include rows the reader may not see."
- Nested and table-wide orders, a move between parents, insert at a place, an event on move: "Not expressible, say
  so in not_delivered: an order over a whole table, an order within an optional or a self relation (a tree of
  pages, nested blocks), moving a row to another parent in one call, creating at a given place (create, then
  move), an event on move."
- Tree and ancestor asks stay open as tree queries; the backlog entry "relations beyond many-to-one" says a line
  filed there from now on is a tree ask unless it names a junction.

## The proof

- **`fixtures/music`**, new, on all three backends. MU-1 accounts and the catalog (the tracks of an album in
  order: append, the list by page, move as owner, as another user 403, without a session 401, `to: 0` a 400,
  `to: 99` last, the album's `tracks` in order, the number refused in create and update, delete closing the gap,
  move of a deleted row 404). MU-2 genres (a junction with a unique pair, relations on both sides, names in get
  and list, a duplicate 409, another user's tag 403, untag). MU-3 playlists (an ordered junction without a unique
  pair, the same track twice, private and public reads, move as owner, the playlist's tracks by title in order, a
  track deleted from the catalog leaving the playlist with its places closed, append after it, delete, clamp).
  MU-4 the pages. No overlay: the fixture has no handler of its own.
- **Workspace WS-12**, under `isolation: database`: a position added to Milestone, team labels, a junction that
  names its team, `labels: { through: MilestoneLabel, to: label_id }`; an outsider's move is the 404 of
  `hidden: not_found`, another team's label is a 400.
- **The `order` walk** on every backend: 8 creates at once, a move of every row at once, then creates, moves and
  deletes together, each followed by the database's own view of the parent. Music walks Track and PlaylistTrack,
  workspace Milestone (as a non-superuser owner with the app role bound).
- **`packages/core/test/order.database.test.ts`** on PostgreSQL: 24 connections, appends, moves, removes, plain
  deletes and cascades from the far side, 60 writes each by default (`OSL_ORDER_ROUNDS`, `OSL_ORDER_SEED` for a
  heavier or a replayed load; ten seeds at 400 and 600 writes each ran clean), no failed statement, no shared
  place; a second case with appends, moves and removes alone ends 1..n with no settling; the control removes the
  lock from the append trigger and the constraint refuses. A fourth case migrates an isolated model and calls
  `osl_move` and `osl_remove` as the app role: with no tenant bound, or another one, they answer as for a missing
  row and change nothing, and the lock helper is not the role's to call.
- Every earlier scenario passes unchanged, and the snapshots of blog, todo and of workspace through WS-11 are byte
  for byte what they were until WS-12 is applied: the IR additions are optional and no shared module changed for
  a model without the constructs.

## Size

About the pages round, as the roadmap guessed, with the database objects as the part that took the redesigns: core
(model, diff, IR, `order.ts`, the planner and drift) is roughly 700 lines, the shared TypeScript generator 150, the
web generator 430, Go 150, the walk 150, the tests 900.

## What it leaves open

- The pages are type-checked and built by both web backends; no browser drove a drag in this round.
- `lock_not_available` after ten seconds of a held row is a 500 on every backend. It needs a row of the parent
  held that long by something else. (A 503 `busy` since the hardening pass of 2026-11-10; the server still does
  not send the statement again itself.)
- A transaction of the user's own that writes two parents takes their locks in the order it writes them; two such
  transactions in opposite orders can deadlock, as any two-lock code can.
- A move costs the size of its parent (every row is locked, and the ones whose place changes are written).
- The live evals have not met the constructs: the two ask cases have no oracle.
