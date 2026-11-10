# Design: state machines

**Status: built 2026-11-10** (round B4 of the road to 1.0.0). Proposed on 2026-11-09 and built without a design
review stop, so every decision is the owner's to review; they are numbered under "Decisions", and the ones that
departed from the design below or from what the round was recommended to do say so. What changed from the design
while building: a transition is one of the compiler's own actions through the mechanism rounds B2 and B3 made
(`ActionIR.builtin`), not a new action kind; a timer runs a transition as the system, and with it the `archive` and
`restore` of round B3, which had refused that, while a schedule runs none of them, because it has no row; the
statements of all three moved into one generated module per backend that request handlers and timers both call; a
transition whose rule is `none` has no route and is a timer's alone; the field need only be a `read_only` enum; a
transition named `archive` is refused where the entity has `archive:`, so the blog fixture's step is `retire`; the
board takes a drop only on a column a transition reaches and needs no update operation; the proof has a third
intent, on the workspace fixture under `isolation: database`, which the note predated; the page test is a script
outside the repository that drove both web backends in Chromium, because the repository has no browser tests; the
intents are FEAT-16, TODO-8 and WS-16; four diagnostics, not five. Proof: blog FEAT-16 (44 scenario steps), todo
TODO-8 (22 steps and one earlier scenario re-stated) and workspace WS-16 (34 steps), conformance 12/12 with six
walks, the rule walk predicting 200 or 409 from each row's state, 211 unit tests, the oracle gate 37/37, and the
board dragged along an allowed move, two moves no transition allows and a stale card on `drizzle-next` and on
`hono-trpc-vite`.

Every workflow ask in the rounds (review, approval, publishing, locking, archiving) is a status field with rules
about which value may follow which. Today the model answers with a `read_only` enum and an action per step whose
handler `osl implement` writes, so the transition table lives in handlers no scenario can read. The hand-written
applications surveyed for these notes are no better: one carries two status axes on its central entity with the
guards scattered as `WHERE status IN (...)` clauses across repository functions and a watchdog, the other derives
order state from timestamps against a hand-kept allowed-from table. Neither declares a transition anywhere, and both
have had bugs where a step ran from a state it should not have. A declared transition gives the guard, the action,
the event and the board affordance from one line.

## What was asked, in the agents' words

| Ask                                                                                                                                                                | Where                                   | Verdict                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------- |
| "Replace the published flag with a status: draft, in review, or published. Authors submit a draft for review; a new reviewer role approves it, which publishes it" | `blog2-review-workflow` (corpus)        | construct; today an enum plus two actions with handlers  |
| "People can see and edit their own requests while they're pending. Admins from finance see every request" and approve or decline them                              | `gen-r1-06-purchase-request-approvals`  | construct; the `from` list is what "while pending" means |
| "Moderators can pin, lock, or delete any thread in their club"                                                                                                     | `gen-r7-10-club-forums`                 | lock is a transition; pin is a flag, delete is delete    |
| "Writers draft articles inside the publication but cannot put them live themselves; instead they press Submit"                                                     | `gen-r1-02-publication-editorial-teams` | construct, with the rule per transition                  |

No round has reported a cluster for this, because the asks are expressible today as actions whose handlers
`osl implement` writes; what the construct removes is the handler, the guard it must remember, and the board that
cannot know the allowed moves.

## The construct

```yaml
entities:
  Article:
    fields:
      status: { type: enum, enum_values: [draft, in_review, published, archived], default: draft, read_only: true }
      published_at: { type: datetime, read_only: true }
    transitions:
      field: status
      submit: { from: [draft], to: in_review, rule: "owner:author_id" }
      approve: { from: [in_review], to: published, rule: "role:editor", stamp: published_at }
      reject: { from: [in_review], to: draft, rule: "role:editor" }
      archive: { from: [published], to: archived, rule: "role:editor or owner:author_id when status = published" }
```

`transitions` names one `read_only` enum field of the entity and, per transition, the states it may start from,
the state it ends in, who may run it, and optionally a datetime field stamped with the time it ran. Each
transition is a row action on every resource over the entity, with a handler the compiler writes rather than a
stub:

- `POST /api/articles/{id}/approve`: the entity's read rule and `hidden` apply as for any row action; then the
  transition's rule (default: the entity's update rule); then the guard: a row whose field is not in `from` answers
  409 with code `invalid_transition` and a message that names the states the transition needs and the state the
  row was read in. Otherwise the field is set, the stamp written, and the row returned.
- Scenarios call `articles.approve`; events follow it (`on: articles.approve`); a timer runs it
  (`run: articles.archive`), where the guard means a stale job does nothing, as `when` does today. A schedule does
  not: it has no row (M131, as for any row action).
- A transition with `rule: none` has no route, no button and no scenario step; a timer still runs it. That is how
  a model says "nobody does this by hand".
- Board pages grouped by the field order their columns as the enum declares them, and a card can be dropped only on
  a column a transition takes it to from where it is, under a rule its viewer passes; the drop runs that
  transition, and over any other column the card is not accepted and stays. A board on a field with transitions
  never calls update for the field and its resource needs no update operation.
- Validation: the field must be a `read_only` enum of this entity (M160); every `from` and `to` a declared value,
  no state twice in `from`, and a `to` that is also in its own `from` is an error (M161); a transition named like a
  declared action of a resource over the entity, like `move` where the entity has a position or like an operation
  is an error (M162), and one named `archive` or `restore` where the entity has `archive:` is M151 with the
  sentence round B3 wrote for it; a stamp must be a nullable `read_only` datetime without a default, and not the
  archive field (M163). The example above is valid as it stands: the name `archive` is free on an entity without
  `archive:`.

## Decisions

Most consequential first. "Departure" marks where the build did something other than the design first said or
than the round was recommended to do; "Addition" what neither named.

1. **A transition is a built-in action** (`ActionIR.builtin: "transition"`), as recommended, not the note's
   `kind: "transition"`. Routes, validation, OpenAPI, the client, scenario steps, the walks and `osl implement`
   (which skips it) came with the mechanism. The IR also carries the machine itself (`EntityIR.transitions`: the
   column, the enum's values, each step with its resolved rule), which the handlers, the board and the rule walk
   read; `transitionOf(ir, action)` finds the step behind an action.
2. **A timer runs the compiler's one-statement row actions as the system: a transition, and round B3's `archive`
   and `restore`.** As recommended, with one narrowing. M133 no longer refuses them. What a timer runs is the
   statement and nothing else, as it runs a handler and nothing else: no rule, no session, no action event (an
   event belongs to the request, for every action a timer runs). The row being written by the compiler, the
   entity's timers are scheduled again afterwards, so a second timer can wait on what the first one stamped; a
   handler's own writes never did that. A row that is not in a state to take the statement is left alone, so such
   a timer needs no `when`. **Departure** from the note, which had "timers and schedules": a schedule runs global
   and collection actions and has no row, so a schedule that names a transition gets the existing M131. `move`
   stays refused for a timer (M133, "needs a place a timer cannot give").
3. **The statements live in one generated module per backend, and round B3's moved there.** A request handler and
   a timer must run the same statement, and the Go packages forbid the cycle that calling a resource module from
   the scheduling module would be. So `generated/row-actions.ts` (TypeScript) and `generated/rowactions` (Go) hold
   `set<Entity>Archived` and one function per transition, and the resource modules import them. Consequence for a
   project that archives and has no transitions: on its next generate it gains that file and its archiving
   resources lose their private `setArchived` (two or three files per backend in the blog and workspace fixtures
   built through their B3 intents; todo, which had neither construct, is byte-identical through TODO-7).
4. **Addition: a transition with `rule: none` is the system's alone.** `none` already means "no route" for every
   operation, and an action with `rule: none` was already runnable by a timer. So a transition written
   `expire: { from: [pending], to: expired, rule: none }` has no route, no button, no scenario step and no event
   (M061), and a timer runs it. The workspace fixture proves it under isolation.
5. **The guard is one conditional update, and the order of answers is rule, then state.**
   `UPDATE ... SET field = to[, stamp = now] WHERE key = $1 AND field IN (from) RETURNING *`; no row back is 409
   `invalid_transition`. The row is loaded first, as for every row action, so a missing row is 404 and the rule is
   checked on the row before the statement runs: a caller the rule refuses gets 401 or 403 and never learns the
   state. A rule that carries a condition on the transition's own field, as the retire rule of the blog fixture
   does for the author, therefore answers 403 to that caller where another gets 409; the scenario shows both. The
   message is built from the row as loaded; in the rare race where the row moved between the load and the update it
   names the state the row was read in.
6. **Under `isolation: database` nothing is added to the database.** No trigger, function or policy, so nothing
   joins `databaseObjects`. The load runs under the policy as the app role: another tenant's row does not come
   back, and B1's existence probe answers what the rule answers a caller it refuses (401 or 403, or 404 under
   `hidden: not_found`) before the update is tried, so a conditional update that matches no row is never mistaken
   for a conflict there. The update itself runs under the policy. A timer runs it through the owner's pool, as it
   runs a handler. A transition's rule is a row action's rule: a public alternative on a tenant table is M126, and
   the compiler adds the membership to every alternative that needs a session (M128). The tenant walk needed no
   change: it already calls every row action as the outsider, in both passes, and takes only 401, 403 or 404.
7. **Addition: a third intent, workspace WS-16**, beside the note's two, because the note predated isolation and a
   design for it that never ran is a liability: a new tenant entity `Request` with approve, decline, reopen and a
   timer-only expire, a count of pending requests on Team, a board.
8. **Names.** On an entity with `archive:` a transition named `archive` or `restore` is M151, with
   `archiveNameClash(resource, entity, field, "transition", name)`; `move` on an ordered entity, an operation's
   name and a declared action's name are M162. The blog fixture's Article archives (FEAT-15), so its step is
   `retire`; the note's own example keeps `archive` and a unit test holds it valid. The reference tells a proposer
   which to use: "removed but recoverable, out of the lists" is `archive:`, a step in a lifecycle is a transition,
   and an entity with both names its step otherwise.
9. **A transition does not look at the archive.** An archived row takes its transitions like a live one, because
   archive only takes a row out of lists (get, update and delete treat it like any other since B3). A model that
   wants otherwise writes `when archived_at = null` on the transition's rule. The blog scenario retires an archived
   article and reads both stamps afterwards.
10. **A count with a `where` on the field follows a transition with nothing built**, as B3 said: the count's update
    trigger reads the row. `User.approved_count` (blog) and `Team.pending_requests` (workspace, through a definer
    function, including the step a timer makes) are scenario steps, and both walks compare them with the rows.
11. **The field is a `read_only` enum, and a transition sets it and the stamp, nothing else.** A default is not
    demanded (a required read-only field without one is M065 already; a nullable one starts null and only a
    handler moves it). A stamp is never cleared: the workspace fixture's `reopen` leaves `decided_at` as the
    decline set it. A handler of the user's may still write the field; the guard is about the transitions.
12. **The op is `set_transitions { entity, transitions | false }`**, replacing the block; `false` removes it and
    leaves the field and the stamps. `rename_field` follows the field, the stamps and the rules; `remove_field`
    refuses the field and a stamp. An action that became a transition is dropped with `update_resource`, not
    `remove_action`, which would also drop the scenarios that call it.
13. **TODO-8 puts the state machine beside the handler-backed `complete`, and one earlier scenario had to be
    re-stated.** The fixture keeps `tasks.complete`, whose handler sets the status (a handler of the user's may
    still write a read-only field), and adds `start`, `pause` and `finish`; the three earlier scenarios that call
    `complete` are untouched. The status became `read_only`, which the construct requires, so TODO-1's "projects
    and tasks", which set it through update and expected 200, cannot pass as written: TODO-8 removes that scenario
    and adds it again with `tasks.start` in place of the update, and replaces the seed, which created a task as
    `doing`. No applied intent was edited. A first version of the intent replaced the action with a transition of
    the same name (dropped with `update_resource`, so the scenarios that call it ran on against the transition) and
    passed on all three backends; it was not kept, because the fixture's overlay then has to lose a handler that
    the eval cases based on the fixture's earlier intents still need in a full run.
14. **The board.** `group_by` on the field of the entity's transitions generates a different index: a `MOVES`
    table (each transition with a route: `from`, `to`, the viewer's rule as the page evaluates it, the client
    call), a column that answers `dragover` only when a move takes the dragged card there, a drop that runs the
    transition with the card moved at once and put back on a refusal, and a line saying why a card let go over
    another column did not move. M087 no longer asks such a page's resource for an update operation, and now
    refuses a board over a `read_only` enum without transitions, which used to generate an update the API would
    refuse. The detail pane shows a transition's button only on a row in a state it starts from, as it shows
    Archive only on a live row. A board over any other enum is generated as before.
15. **Departure: the "page test" is not in the repository.** It has no page or browser tests, and this round adds
    no browser dependency. A script outside it built the todo fixture on each web backend, started the app on a
    real database and dragged cards in Chromium with Playwright: todo to doing ran `start` and answered 200 with
    the card and the row in doing; todo to done and done to todo sent no request, left the card and the row where
    they were and showed the line; a card whose row had been moved behind the page ran `pause`, got 409 and ended
    where the row was; no update of the field was ever sent. A page walk in the harness is not built.
16. **The rule walk predicts a transition** the way B3 taught it archive: the rule, then 200 when the row's state
    is in `from` and 409 when it is not, then the row read back. Its detail counts the allowed calls that moved a
    row and those that answered 409 (blog: 12 and 7; workspace: 3 and 6; todo: none, since the walk runs
    `complete` first and the update rule then refuses the frozen row three times).
17. **The code `invalid_transition` is on the wire on the REST backends only.** `hono-trpc-vite` answers a tRPC
    `CONFLICT` with the code as the error's cause, as it does for every code (`invalid_reference` too); the
    harness reads the status, and no scenario asserts a code. Putting codes into tRPC's error data is a change to
    every project's `trpc.ts` and was left out of this round. **Fixed on 2026-11-10, after milestone B:** the error
    formatter puts the contract's code in the error's data as `contractCode` for every refusal, so a scenario step
    that expects `invalid_transition` passes on all three backends (todo TODO-9 asserts it).
18. **Diagnostics M160 to M163**, the round's block, plus the existing M151, M087, M131 and M133 with new cases.
    The note counted five; the rule of a transition is checked by the rules' own codes.
19. **Intents FEAT-16, TODO-8 and WS-16**: the note named FEAT-15, which round B3 took.
20. **Eval corpus.** A new expectation key, `transitions: { Entity: [name or "from -> to"] }`; three fixture
    cases; `blog2-review-workflow` re-expected with `any_of` (transitions, or the two actions as before); one new
    ask, `empty-leave-requests`, which requires the construct; `todo4-archive-projects`, the one case based on the
    whole todo fixture, pinned `through: TODO-7`.

## Mapping

- Core: `Entity.transitions?: { field, <name>: { from, to, rule?, stamp? } }`; the diff op `set_transitions`;
  `EntityIR.transitions` and one `ActionIR` with `builtin: "transition"` per step and resource (a step whose rule
  is `none` stays an action without a route, for a timer); `statementActions(ir)` lists what a timer can run
  without a handler; M160 to M163.
- drizzle-next and hono-trpc-vite: `generated/row-actions.ts` holds, per entity, `move<Entity>(id, from, values)`
  (`db.update(...).set(values).where(and(eq(id), inArray(field, from))).returning()`) and `<entity>Transitions`
  with one function per step; the action handler loads the row, checks the rules, calls it and fails 409 when it
  returns nothing. `generated/scheduling.ts` calls the same function for a timer and then `scheduleTimers`. The
  board page component is generated with the transition table and maps drops to actions.
- gin-pgx: package `generated/rowactions`, `Transition<Entity><Step>(ctx, db, id, now)`, the same statement with
  the states as a text array (`field::text = ANY($3)`), `nil` when it matched no row; the handler and the
  scheduling package call it.
- OpenAPI: each transition's summary is "Moves the row's <field> from <states> to <state> ... 409
  (invalid_transition) when the row is in another state"; the 409 response is the shared one.
- Reference: a paragraph after Archive with the grammar, the order of answers, what calls a transition, the
  board, and the rule for choosing: a step that only sets the status (and a timestamp) is a transition; a step
  that takes input or does more stays an action with a handler.

## Under `isolation: database`

| Piece                     | What happens                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables, triggers, queries | none added; the state is a column of the entity's own table, under that table's policies                                                                 |
| The load                  | as the app role with the caller's tenants bound: another tenant's row does not come back, and the existence probe answers 401, 403 or 404 before the 409 |
| The update                | as the app role under the same policy; it can only match a row the load returned                                                                         |
| A timer                   | the statement through the owner's pool, as the system, like every job                                                                                    |
| The rule                  | a row action's: no public alternative on a tenant table (M126); the tenant's membership added to every alternative that needs a session (M128)           |
| A count over the field    | the count's definer function, unchanged from B3                                                                                                          |

## Declined, with the sentence the reference gets

- Input on a transition (a rejection reason): "a step that takes input or does more than set the field stays an
  action with a handler, which writes the field itself; a side effect of a transition is an event handler on it".
- Two transition blocks on one entity (two status axes): one per entity in this version; "the second status is
  actions with handlers".
- A transition that sets other fields, or clears a stamp: "a transition sets the field and its stamp".
- Transition history: the audit brief (`audit-and-webhooks.md`) records every transition as an audit entry when
  the entity has `audit: true`; no separate log.
- Guards on other fields: already expressible as a row condition on the transition's rule (`when locked = false`).
- A schedule that runs a transition over many rows: a schedule has no row; a collection action with a handler
  does the sweep, or a timer does it row by row.

## Proof

- Fixtures, each on all three backends:
  - blog FEAT-16 "editorial review" adds `status` (draft, in_review, approved, retired) with `submit`, `approve`,
    `reject` and `retire` on Article beside the existing `publish` action and the `archive:` of FEAT-15, to show
    that a transition, a handler-backed action and the compiler's archive coexist on one entity. 44 steps: the
    status refused in create and update (400), each transition refused to the wrong caller (401, 403) and from
    the wrong state (409), the stamp, the count of approved articles on User, `publish` still working, an archived
    article retired, a timer that retires an approved article after thirty days and leaves one retired by hand as
    it was, and a second timer that archives a retired one thirty days later, which is the compiler's `archive`
    run by a timer on a stamp another timer set. An event follows `posts.approve`. A board page by status.
  - todo TODO-8 "task flow": `start`, `pause` and `finish` on Task's status, `completed_at`, the handler-backed
    `complete` kept beside them (decision 13), the existing board now dragging along the transitions. 22 steps.
  - workspace WS-16 "requests and approvals" under `isolation: database`: decision 7. 34 steps, among them the
    outsider's 403 on a row of another tenant, the member's 403, the 409s, the row frozen by its update rule once
    it left pending, the timer-only expiry at fourteen days and the team's count after each step.
- The walks: rule (decision 16), tenant twice (22 rows of the home team, the Request rows among them, with the
  rule checks off too), contract (todo: two breaking changes, both explained by TODO-8's ops).
- Unit tests: `packages/core/test/transitions.test.ts` (16), and round B3's test of M133 turned into one that a
  timer runs archive and restore.
- The board in a browser: decision 15.
- Eval cases: `fx-blog-16-editorial-review`, `fx-todo-8-task-flow`, `fx-ws-16-requests`, `blog2-review-workflow`
  re-expected and `empty-leave-requests`; the oracle gate 37/37. The two asks were checked against hand-written
  answers, and an answer with actions and handlers fails `empty-leave-requests` as it should.

## Size

As estimated: smaller than the scheduling round, and the board the largest single piece. Core: the block, the op,
the IR, four diagnostics (about 330 lines), the reference (60) and the unit tests (460). The generated module of
each backend with the handlers' and timers' calls into it (about 400 lines over the three backends, a third of
them replacing round B3's own statement). The board and the buttons (about 215). The walk (30) and the evals key
(40).

## What it leaves open

- No page walk in the harness: the board's drag is proven by a script that is not in the repository.
- The 409's code is not on the wire under tRPC (decision 17). Fixed on 2026-11-10: it is `contractCode` in the error's
  data.
- A timer that runs an action with a handler still does not schedule the entity's timers afterwards, and no timer
  emits the action's event; only the compiler's statements schedule (decision 2).
- Replacing a handler-backed action with a transition of the same name works but no fixture does it (decision
  13). A handler file left behind by an action that became a transition, or was removed, is dead code, and breaks a
  Go build until it is deleted; `osl generate` does not remove scaffolds.
- `rename_field` does not rewrite the rule of `archive: { rule }` (round B3's), though it does rewrite a
  transition's; validation catches the stale name.
- The live evals were not run: the asks have never met a model.

## At the merge with rounds A3 and A4 (2026-11-10)

A detail page (round A3) offers a transition from the row's state as the detail pane did (WS-16's `request` page,
blog's article page), and a board over the field of a state machine takes a page's `{tenant.id}` filter as any
board does.
