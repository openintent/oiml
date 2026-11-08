# Agent evals

`osl propose` is the agent path: an intent in prose goes to Claude, which answers with a model diff that is
validated against the current model and retried once with the problems. The evals measure how often that
produces a correct diff, and where it fails, so the reference text, the prompt and the model can be improved
against numbers rather than anecdotes.

```bash
pnpm evals                                   # every case, live against Claude, then the full harness on hono-trpc-vite
pnpm evals --no-full                         # propose, check and generate only (seconds per case, no database)
pnpm evals --only blog2-comments,empty-notes # a few cases
pnpm evals --tag tenancy                     # one slice
pnpm evals --model claude-sonnet-5-5         # another model
pnpm evals --proposer oracle                 # the fixtures' own diffs instead of Claude: the grader must pass them all
pnpm evals --proposer null                   # an empty diff: the grader must fail everything that expects a result
pnpm evals --compare evals/propose/runs/<earlier run>   # per-case differences after a change
```

`ANTHROPIC_API_KEY` and `OSL_TEST_DATABASE_URL` are read from the environment, `.env.local` and `.env`.
A run writes `evals/propose/runs/<timestamp>-<proposer>/` with `summary.md`, `results.json` and, per case,
the diff, every attempt with its validation problems, the fixture the harness ran, and the harness log.
Runs are not committed.

## The corpus

`evals/propose/cases/*.yaml`, one case per file. A case is an intent, the model it starts from, and what a
correct diff must contain:

```yaml
id: blog2-comments
tags: [entity, relation, rules, list, scenario]
base: { fixture: blog, through: FEAT-2 }   # or { empty: <name> } for a new project
intent:
  title: Comments
  ask: Signed-in users comment on posts ...
  acceptance: [An anonymous comment is rejected with 401, ...]
expect:
  entities: [Comment]
  fields: { Comment: ["body|content|text", post_id, "author_id|user_id"] }
  relations: ["Comment.post_id -> Post:cascade", "Comment.* -> User"]
  rules: { Comment: { read: public, delete: "owner:author_id|owner:user_id" } }
  resources: [comments]
  list: { comments: { filters: [post_id] } }
  scenarios: { min: 1, rejections: 1, statuses: [401, 403] }
  touches: [comments]
```

Names may offer alternatives with `|`, because an intent that does not name things leaves the agent free
to choose. The checks read the model after the diff is applied (and its IR, for rules and actions after
defaults), so they judge the result, not the spelling of the ops. The full list of checks is the `Expect`
schema in `packages/evals/src/cases.ts`: entities and fields present or absent, types, field properties,
relations with their `on_delete`, unique constraints, junction entities, rules, resources and operations,
list options, actions by name or by shape, auth providers and tenancy, events, pages and the sidebar, file
rules and accept lists, seed steps, scenario counts and rejection statuses, what the scenarios call, an actor
carrying given fields (`actor_fields: { role: admin }`), and the ops a diff must use, may not use, or how
many it may have.

`outcome` says what should happen: `ok` (the default) needs a valid diff, `invalid` expects none to exist,
`declined` expects the agent to answer that nothing in the ask is expressible, and `any` accepts whatever
happens. `flags_limit: true` says the ask has a part the model cannot express, so a valid diff must list it
in `not_delivered` (the agent's own channel for that) or the agent must decline. Cases tagged `gap` ask for
something the model cannot express, and cases tagged `trap` for something the reference forbids or caps;
both exist to show what the agent does there, and their diffs are for reading, not only counting.

Eleven cases are the fixtures' own intents and carry `oracle:` pointing at the fixture's diff; the rest are
new asks over the fixtures' models at different points, or over an empty model.

## What a case measures

| Column | Meaning |
| --- | --- |
| Status | `ok`: a valid diff within the attempts. `invalid`: none after the retry. `declined`: the agent said nothing is expressible, with reasons. `error`: the API or the runner failed; not graded. |
| Attempts | 1 means the first diff validated; 2 means the retry with the problems was needed. |
| Checks | The expectations above, on the applied model. |
| Generate | Every backend generated the project (a pure function of the IR, so this catches compiler gaps). |
| Full | The conformance harness on one backend: install, typecheck, migrate a throwaway database, drift, start, and run every scenario in the model, including the ones the diff added. |
| Pass | Outcome as expected and every check, generate and full step passed. |

Full runs of diffs that add actions are reported separately: the generated handler stubs return the row
unchanged, so a scenario that expects the action's effect fails until a person writes the handler. That is
the intended division of labour, not an agent mistake.

The summary also groups every validation problem the agent hit by shape, across attempts. A problem that
recurs across cases is a sentence missing from the reference (`packages/core/src/reference.ts`), which is
the text the agent reads; fixing it there improves `osl propose`, the MCP server and the docs together.

## Changing the prompt or the reference

1. Run the suite and keep the run directory.
2. Change `reference.ts`, the system prompt in `packages/cli/src/propose.ts`, or the model.
3. Run again with `--compare <previous run>`; `compare.md` lists the cases whose result or attempt count changed.

The corpus is the spec of what the agent should get right. When a case fails because its expectation was
wrong, fix the case; when it fails because the model cannot express the ask, that is a feature request, and
the case stays as a gap until the construct exists.

## What the first run found

The first live run (59 cases, Claude Opus 5.5, 2026-11-08) produced a valid diff for every case, 90% on the
first attempt, and every diff generated on all three backends. Running the generated apps told a different
story, and each failure became a fix:

- `applyDiff` installed the diff's own objects into the model by reference, so a later op could change the
  diff as it applied. Fixed, with a test.
- Deleting a row that another row references with `on_delete: restrict` answered 500: Postgres raises
  `restrict_violation` (23001), and the backends mapped only `foreign_key_violation` (23503). Fixed on all three.
- A table referencing itself did not typecheck under Drizzle without an `AnyPgColumn` annotation; a required
  file field did not typecheck because the resolved reference was typed optional; `min`/`max` on a decimal were
  not enforced on the TypeScript backends or in Go. All fixed.
- A list with an owner read rule and no filters used `and` without importing it on hono-trpc-vite. Fixed.
- Agents gave actors a `role` (at the time the harness registered actors through the API, which never accepts
  one) and listed `create.fields` that omitted a required relation under a non-owner rule. Both became
  validation diagnostics the retry can act on, instead of failing at run time; the first has since turned into
  a feature (below).
- Agents wrote upload steps without `expect`, integer ids as numbers, magic-link verification without
  capturing the token, and flow mappings with unquoted commas. The schema now accepts numeric path and query
  values, and the reference says the rest.
- Given an ask the model cannot express, the agent padded a diff rather than say so. `propose` now has a
  `not_delivered` channel and may decline; the gap cases check that it is used.

The second run, after those fixes, passed 45 of 59 cases with no validation retries at all (every diff valid
on the first attempt, three asks correctly declined). Ten of the remaining failures were action handlers left
as stubs. The other four became the next round: the harness now registers every actor before a scenario runs
(a scenario that signed an actor in explicitly before acting as them used to fail), the reference says a row
the read rule hides is a 403 rather than a 404, the junction check accepts an own-id link table with a unique
pair, and a case may offer `any_of` alternative designs when two models answer the same ask.

The clearest feature request the runs produced was an admin actor: every role rule in the corpus could only be
tested from the refused side. That construct now exists: an actor may set `role`, and the generated test
harness and `osl seed` register the actor through the API, then write that column straight into the database
(so the tests and the seed need `DATABASE_URL`). The blog fixture's digest and unpublish actions are
admin-only and proven from both sides on all three backends, and the admin cases in the corpus
(`blog1-admin-ban`, `blog5-stats-action`, `blog1-create-user-trap`, `fx-blog-5-publishing`) now require an
admin actor and a 200 next to the 403. A live run of those four right after the change produced a valid diff
on the first attempt for each, every one declaring an admin actor and using it; their full runs then fail
only on the action handler stubs, which is the bucket the report keeps apart (before the change three of
them passed in full, because a stub satisfies a scenario that only shows the refusal).

The agents' `not_delivered` notes then named the next constructs, and the corpus's two rule gaps closed in one
round: a rule may now list alternatives (`update: "owner:author_id or role:admin"`, any of which allows), and an
owner or member predicate may follow relation fields to the row it tests (`owner:article_id.author_id` on a
comment, `member:project_id.team_id` on a task). Lists filter through the relations with subqueries, creates
check the related row, and all three backends resolve the path before the check. The blog fixture gained
comments whose deletion is allowed to the commenter, the article's author or an admin, and the workspace fixture
gained tasks visible to their assignee or the team's admins; both are proven on every backend. In the corpus,
`blog2-admin-moderation` is no longer a gap, `ws1-tasks-member-rules` accepts the path form, and three cases
were added (`fx-blog-6-comments-moderation`, `fx-ws-3-tasks`, `ws2-project-notes`). The limits still open are
fields a client may never write (a `banned` flag that register would otherwise accept) and rules on the value
being written (no admin may grant `owner`).

## Another model

The same corpus on Claude Sonnet 5.5 (2026-11-08, before the rules round): 44 of 59 passed against Opus's 45, with
97% valid diffs and 93% valid on the first attempt (Opus: 95% and 95%), two asks declined, at $1.45 against $2.69.
Eleven of its fifteen failures were action handler stubs. The other four were worth reading: a junction entity
with a two-column key exposed as a resource, which generation refuses and validation should have refused
first; a scenario step reading one row without `path.id`, now diagnostic M072; a scenario expecting 403 from an
operation whose rule is `none`, where the route does not exist at all, which the reference now says; and a
self-relation whose include failed under Drizzle because the two relations between a table and itself were
unnamed, fixed in the schema emitter. A smaller model is a cheaper way to find the places where the reference
leaves room for a wrong guess.
