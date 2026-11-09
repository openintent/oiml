# Design: hidden rows as not found

The top open gap after the relations round, and the one agents have asked for in every round since r2: a get of a
row the read rule hides answers 401 or 403, and the ask wanted 404, so that a draft, another tenant's course or
another user's task does not announce that it exists. The reference says the opposite today ("a get of a row the
read rule hides from this user: never 404"), and agents quote that sentence back in `not_delivered`. This note
gives the behaviour a spelling, a mapping on all three backends, and a proof. It is the design to review before
the build; the grammar is permanent.

## What was asked, in the agents' words

| Ask                                                                                      | Where                  | Verdict                                                                            |
| ---------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| "A visitor who is not signed in can read a published story but gets a 404 for a draft"   | r6-04 (newsroom)       | construct                                                                          |
| "A teacher from one school gets a 404 when opening a course belonging to another school" | r6-06 (schools)        | construct                                                                          |
| "A regular user who requests another user's task gets a 403, not a 404"                  | r2-04 (task board)     | construct                                                                          |
| "Opening another technician's job directly answers 403, not 404"                         | r2-03 (dispatch)       | construct                                                                          |
| "A signed-out visitor opening a non-public project gets a 401, not a 404"                | r2-05, r5-10 (roadmap) | construct, for the row check; a refusal before the row is loaded stays 401 (below) |
| "Nobody can delete through the API, so a delete call answers 404 rather than 403"        | r6-08 (forum)          | already so: `none` leaves the route out                                            |
| "The 404 for a switched-off link comes from the handler"                                 | r5-01 (requests)       | a handler's business, not a rule                                                   |

## The construct

```yaml
entities:
  Announcement:
    rules:
      read: "public when published = true or owner:author_id or role:admin"
      update: "owner:author_id or role:admin"
      hidden: not_found
```

`hidden` under an entity's rules says what a row the read rule hides from the caller answers when the caller
addresses it by id: `forbidden`, the default and today's behaviour (401 or 403), or `not_found`, the same 404 and
the same body a missing row gets. It applies to every operation that loads a row before checking a rule: get,
update, delete and row actions. The read rule decides visibility; an update or delete of a row the caller cannot
read answers 404 before the operation's own rule is consulted, otherwise the existence the get hid would leak
through the update.

| Caller and row                                                                         | Today                    | With `hidden: not_found`                                       |
| -------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------- |
| Anonymous, a draft, the read rule has a `public when` alternative                      | 401                      | 404                                                            |
| Signed in, not the owner, a draft                                                      | 403                      | 404                                                            |
| The same caller updates, deletes or runs a row action on that draft                    | 403                      | 404                                                            |
| The same caller updates a published row the update rule refuses                        | 403                      | 403 (visible, refused)                                         |
| Anonymous, read rule `owner:author_id` alone (no alternative allows anonymous callers) | 401                      | 401 (answered before the row is loaded, the same for every id) |
| A member of another team, read rule `member:project_id.team_id`                        | 403                      | 404                                                            |
| No such row, or an id with the wrong format                                            | 404                      | 404, the same body                                             |
| A list                                                                                 | hidden rows filtered out | unchanged                                                      |

Decisions, and why:

- **One setting per entity, under `rules`.** Visibility is what the read rule defines, so the setting sits next
  to it and travels with `set_rules`; no new diff op, nothing for rename or remove to map. A per-operation choice
  (404 on get, 403 on update) was considered and declined: the other operation would leak what the first hid.
- **Opt-in, default `forbidden`.** Dozens of scenario steps across the fixtures and every saved proposal of rounds
  1 to 6 assert 401 or 403 on hidden rows, because the reference told agents so, and every app generated so far
  has that contract. The reference gains the rule for choosing: set `hidden: not_found` when the ask says a row
  must look as if it did not exist (404, "never see", "does not exist for them"); keep the default when the ask
  says refused or says nothing.
- **The check before the row is loaded does not change.** A rule that needs a session answers 401 to an anonymous
  caller, a wrong role answers 403, before any id is looked at; those answers are the same for every id, real or
  not, so they reveal nothing, and "sign in" is the useful answer. Only the row check, the one that depends on
  which row it is, turns into 404. The roadmap asks get their 404 all the same: their read rule has a
  `public when public = true` alternative, so an anonymous caller passes the first check and the row check answers.
- **The same 404.** The handler's `notFound()` (TypeScript) and `httpx.NotFound()` (Go) answer both the missing and
  the hidden row, so the two cannot be told apart by status, code or message.

## Mapping

- Model: `Rules.hidden?: "forbidden" | "not_found"` (the strict object gains a key). The entity validation loop
  that checks every rule iterates the four operations rather than every key of `rules`. One diagnostic, M035, a
  warning: `hidden: not_found` has no effect when the read rule never hides a single row, that is when no
  alternative depends on the row (`public`, `authenticated`, `role`, `none`, or alternatives made only of those):
  "rules.hidden has no effect: the read rule allows or refuses every row alike".
- IR: `EntityIR.hidden: "forbidden" | "not_found"`, beside `rules` rather than inside it, so the code that iterates
  the four rules (list filters, `ruleRow`, `ruleValuesSource`) is untouched.
- drizzle-next and hono-trpc-vite: the generated resource module already has `RULES.read` and, when any rule has a
  path, `withRuleValues`. Get: when the row check refuses, answer `notFound()` instead of `denied(verdict)`.
  Update, delete and row actions: before the operation's own row check, `checkRule(RULES.read, session, row)`
  through the same `rowArg`, and `notFound()` when it refuses. `withRuleValues` already resolves the read rule's
  paths, since `ruleValuesSource` is built over all four rules and the actions. The shared access runtime
  (`verdict`, `satisfied`, the list filter) does not change.
- gin-pgx: a `HIDE_ROW` counterpart of `DENY_ROW` that fails with `httpx.NotFound()`, emitted in Get on refusal
  and in Update, Delete and the row actions before the own check; `ruleRow` already resolves every rule's paths.
- OpenAPI: the descriptions of get, update, delete and row actions on such an entity end with "A row the read
  rule hides answers 404."
- Web: nothing. The client already treats 404 as a refused request (no retry) and the detail pane shows the
  error's message, so a hidden row reads "Not found".
- Diff: `set_rules` carries the key; `mapRuleFields` ignores it.
- Grader: a `rules.<Entity>.hidden` expectation compares with the IR's value; the gap topic "hidden rows as not
  found" already exists.
- Reference: the errors line becomes "403 the rule refuses (a row the caller may read; with `hidden: not_found` a
  row the read rule hides answers 404 like a missing one)", and a paragraph under rules gives the key, the table
  above in two sentences, and the rule for choosing. `docs/model.md` regenerated, `docs/backends.md` rules row
  extended.

## Declined, with the sentence the reference gets

- A per-operation choice: one setting per entity; say why in the reference.
- A default flip to 404: compatibility; the reference tells agents when to set the key.
- 404 for a create whose related row the caller cannot read (a comment on a hidden article answers 403, since the
  server resolves the related row without checking the caller's right to read it): logged as a gap of its own if
  it appears; not built here.
- Related rows under `include` are not checked against their own read rule: separate, logged.
- A handler's own 404 (a switched-off link): the handler's business, as today.
- `none` already answers 404 because the route does not exist; the sentence stays.

## Proof

- Fixtures: blog FEAT-11 "announcements with private drafts" adds `Announcement` (title, body, author_id → User,
  published false by default, created_at) with the rules above and `hidden: not_found`, a resource with a `publish`
  row action (owner or admin; an overlay handler sets published), a table page and a sidebar entry, and a scenario
  that shows an anonymous get of a draft (404), another user's get, update, delete and publish of it (404 each),
  the admin's and the author's get (200), an anonymous list without it, the author publishing it, an anonymous
  get after that (200), the other user's update of the now visible row (403), and a get of an unknown id (404).
  Workspace WS-8 "project milestones" adds `Milestone` (project_id → Project, title, due_on, done) with
  `member:project_id.team_id` for read, create and update, `member:project_id.team_id:admin` for delete and
  `hidden: not_found`, and a scenario in which a member of another team gets, updates and deletes a milestone
  (404 each), a member of the team reads it (200) but cannot delete it (403, visible and refused), an anonymous
  caller is told to sign in (401, before the row), and the team's admin deletes it (204, then 404). The second
  fixture covers the path through `ruleRow` and `withRuleValues` that the first does not.
- Eval cases: `fx-blog-11-private-drafts` and `fx-ws-8-milestones` with the fixtures' diffs as oracles, expecting
  `hidden: not_found` on the entity and statuses 404 and 403 in the scenarios; the newsroom ask (r6-04) promoted as
  `blog5-newsroom-drafts` with the same expectation on its story entity.
- Gate: conformance 9/9, snapshots, the oracle grader, rounds 1 to 6 graded again with `--resume` losing nothing,
  a fresh round no longer reporting "hidden rows as not found"; then `built` in the backlog.

## Size

Core: the key, M035, the IR field, the OpenAPI sentence, the reference. Four handler sites in each TypeScript
backend, a helper and four sites in Go. The grader's rules expectation. Two fixtures with one overlay handler
each, three eval cases, snapshots. About half the relations round.
