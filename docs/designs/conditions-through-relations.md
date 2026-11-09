# Design: conditions through relations, and conjunctions

**Status: built 2026-11-08.** What changed from the design below while building: a rule with alternatives now
answers 401 whenever the caller has no session and an alternative wanted one (before, one alternative answering 403
made the whole rule 403), so an anonymous read of a private project's task is 401 as the proof says; a list under a
rule that lets anonymous callers through (`public when ...`) guards its owner alternatives on the session, which the
old code did not; the body of a create may not name the bound owner field at all (the input is strict), so "a note
carries the member's own id whatever the body says" is a 400 for a body that names another author and the session's
id otherwise. Proof: workspace WS-7 (public projects and notes), blog FEAT-10 (locked articles), conformance 9/9 on
all backends, eval cases `fx-ws-7-public-projects-and-notes`, `fx-blog-10-locked-articles`, and `ws2-project-notes`,
`blog2-forum-autolock`, `ws2-public-roadmap` tightened.

The top open gap after the scheduling round, and the one the rules keep running into: a rule that must look at a
related row ("tasks are public when their project is public", "no replies to a locked thread"), and a rule that
must require two things at once ("a member of the project's team, and the author is the signed-in user"). Both
are extensions of what rules already do; this note gives them a spelling, a mapping on all three backends, and a
proof. It is the design to review before the build; the grammar is permanent.

## What was asked, in the agents' words

| Ask | Where | Verdict |
| --- | --- | --- |
| "A task's read rule can only check the task's own fields, not whether its project is public" | r5-10, r1-07 | construct: a condition through a relation |
| "Refusing replies to a locked or inactive thread: a create rule cannot depend on a field value of the related thread" | r1-09, blog2-forum-autolock | construct: a condition through a relation, on create |
| "The rules can require publication membership on create or bind the author to the session, but not both at once, so a member could file a draft under another person's name" | r1-02, r3-09, ws2-project-notes | construct: a conjunction of predicates |
| "Filtering the projects list itself by tag: list filters only take the entity's own fields" | r3-02 | separate, a list construct; noted, not built here |
| "A deactivated account is refused at sign-in or blocked from writing" | r2-04 | separate, an auth setting; noted, not built here |

## Constructs

### 1. A condition through a relation

```yaml
entities:
  Task:
    rules:
      read: "public when project_id.public = true or owner:assignee_id or member:project_id.team_id:admin"
  Comment:
    rules:
      create: "owner:author_id when article_id.locked = false"
timers:
  - { on: Reply, at: created_at, after: 30d, run: replies.archive, when: "thread_id.locked = true" }
```

A `when` may name a path the way owner and member predicates already do: every segment but the last is a
relation field of the entity reached so far, the last is a field of the entity the path lands on, and the
literal is typed by that field. The same grammar serves timers' `when`.

- Grammar: `WHEN_CLAUSE` takes `[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*` for the field; `RuleCondition.field` keeps the
  dotted text; `splitWhen` is unchanged.
- Validation: M032 walks the path like `checkPredicate` does for owner paths (a segment that is not a relation,
  a missing field) and M033 types the literal by the final field; a condition on a path from an entity with no
  single-column key is refused like a rule path is.
- IR: `RuleConditionIR { column, op, value, via?: RuleHopIR[] }`, compiled with `hopsFrom`; the runtime key is the
  dotted path (`project_id.public`), the same convention `ruleKey` uses for owner paths.
- Row checks (get, update, delete, row actions; a timer firing): `withRuleValues` and the Go `ruleRow` already
  resolve every path a rule has into the row under its dotted key; they gain the conditions' paths. `holds`
  reads `row["project_id.public"]`, nothing else changes.
- Lists: the condition's SQL follows the hops with a subquery, exactly as owner paths do:
  `inArray(tasks.project_id, db.select({ id: projects.id }).from(projects).where(eq(projects.public, true)))` on
  Drizzle, `"project_id" IN (SELECT "id" FROM projects WHERE "public" = $1)` on pgx. Combined with the row part of
  the same alternative with AND, as today.
- Create: `needsBodyCheck` is already true for a condition; the body's relation field is resolved through the
  hops before `holds` runs, so a comment on a locked article answers 403 and a comment naming a missing article
  answers 403 too (the related row is not there to allow it). A condition default from the related row's
  literal default is not assumed: the related row exists and is read.
- Web pages: the client-side `rulePredicate` cannot see a related row; a conditioned predicate with a path offers
  the control when its base allows and lets the API decide, the way owner paths are treated already.
- OpenAPI notes print the condition as written.

### 2. Conjunctions

```yaml
entities:
  Note:
    rules:
      create: "member:project_id.team_id and owner:author_id"
      update: "owner:author_id or member:project_id.team_id:admin"
```

`and` binds tighter than `or`: `a and b or c` allows when both a and b allow, or when c does. Every part of a
conjunction must allow; a part that needs a row is checked against the row, and a plain owner part keeps its
meaning on writes: on create the owner field is set from the session (so the member part checks the body's
project and the author is bound, which is exactly the ask), on update the owner column stays out of the writable
fields when every alternative binds the owner.

- Grammar: `RULE_PATTERN` becomes alternatives of conjunctions, `PREDICATE( and PREDICATE)*( or ...)*`.
- Validation: M034 `none` inside a conjunction (nothing can allow); M034 `public` inside a conjunction (adds
  nothing, a warning); two owner parts on different fields are allowed and mean both must be the user.
- IR: `{ kind: "all"; rules: PredicateIR[] }` as a member of `any` (or the whole rule); `ruleAlternatives` yields
  conjunctions as units, a new `ruleParts` flattens them; `directOwnerOf` finds a plain owner part inside a
  conjunction; `rowDependentRules`, `conditionedRules` and `rowRules` look inside.
- Runtime verdicts (TS `verdict`, Go `Check` and `CheckRow`): all parts allow; when one refuses, the status is 401
  if that part answered 401 without a session, else 403.
- Lists: a conjunction's condition is the AND of its parts' conditions, each built as today (owner column,
  tenant ids, subqueries through hops, when clauses); inside `or` with the other alternatives. A conjunction that
  includes a member part guards on the session's tenants like a plain member rule.
- Web predicate: `&&` of the parts.

## Declined, with the sentence the reference gets

- Comparisons against now in rules ("tasks due before today are read-only"): still the list-and-rules
  construct designed next with the `now` keyword; say so.
- A rule on the session's own row beyond `owner` ("deactivated accounts cannot write"): an auth setting, not a
  rule; logged as a gap of its own.
- Filtering a list by a related entity's field ("projects by tag"): a list construct; logged.

## Proof

- Fixtures: workspace WS-7 adds `Project.public`, makes tasks of public projects readable by anyone, and adds
  `Note` with the conjunction `member:project_id.team_id and owner:author_id`, with a scenario that shows an
  anonymous read of a public project's task (200), of a private one (401), a member's note carrying the member's
  own id whatever the body says, and a non-member refused. Blog FEAT-10 adds `Article.locked` as a read_only flag
  with admin `lock` and `unlock` actions and `Comment.create: "owner:author_id when article_id.locked = false"`,
  with a scenario that locks an article, is refused a comment (403), unlocks, and comments again.
- Eval cases: `fx-ws-7-public-projects-and-notes` and `fx-blog-10-locked-articles` with the fixtures' diffs as
  oracles; `ws2-project-notes` gains the conjunction as its expected create rule; `blog2-forum-autolock` and
  `ws2-public-roadmap` (both promoted generated asks) lose their not_delivered allowance for the refusal.
- Gate: conformance 9/9, snapshots, the oracle grader, rounds 1 to 5 graded again with `--resume` losing nothing,
  a fresh round no longer reporting "conditions through relations" or "rule conjunctions"; then both `built` in
  the backlog.

## Size

Core: the two grammars, M032 and M033 through paths, M034, `RuleConditionIR.via`, the `all` kind and the
helpers over it, OpenAPI notes, reference. Shared TypeScript access (verdict, list filter, `withRuleValues`),
Go access runtime and resources (`Check`, `CheckRow`, list filter, `ruleRow`), the web predicate. Two fixtures,
two new eval cases and three adjusted, snapshots. About the rules round.
