# Design: state machines

**Status: proposed 2026-11-09.** Not yet built. The grammar below is the design to review before the build.

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
the state it ends in, who may run it, and optionally a datetime field stamped with `now`. Each transition is a row
action on every resource over the entity, with a handler the compiler writes rather than a stub:

- `POST /api/articles/{id}/approve`: the entity's read rule and `hidden` apply as for any row action; then the
  transition's rule (default: the entity's update rule); then the guard: a row whose field is not in `from` answers
  409 with code `invalid_transition` and the current state in the message. Otherwise the field is set, the stamp
  written, and the row returned.
- Scenarios call `articles.approve`; events follow it (`on: articles.approve`); timers and schedules run it
  (`run: articles.archive`), where the guard means a stale job does nothing, as `when` does today.
- Board pages grouped by the field order their columns as the enum declares them, and a drag from one column to
  another runs the transition whose `from` and `to` match; where none exists the card snaps back, and the viewer's
  rule decides which drops are offered. A board on a field with transitions never calls update for the field.
- Validation: the field must be a `read_only` enum of this entity; every `from` and `to` a declared value; a `to`
  that is also in its own `from` is an error; a transition named like a declared action of a resource over the
  entity is an error; a stamp must be a nullable `read_only` datetime.

## Mapping

- Core: `Entity.transitions?: { field, <name>: { from, to, rule?, stamp? } }`; a diff op `set_transitions
{ entity, transitions }` (replace the block; `rename_field` updates `field` and `stamp`). The IR lists each
  transition as an `ActionIR` with `kind: "transition"` and the resolved rule, so routes, OpenAPI, scenarios,
  events, timers and the grader see an action. Five diagnostics as above.
- drizzle-next and hono-trpc-vite: the generated action module emits the transition's handler inline (load, read
  rule, own rule, guard with `UPDATE ... WHERE id = $1 AND status = ANY($2) RETURNING *`, 409 when no row came
  back), so the guard is atomic under concurrent calls. The board page component takes the transition table from
  the generated client and maps drops to actions.
- gin-pgx: the same handler in the actions package; the guard as the same conditional update.
- OpenAPI: each transition's description is "from <states> to <state>"; the 409 is documented with its code.
- Reference: a paragraph under Entity after rules, and the rule for choosing: a status whose next value depends on
  its current value is `transitions`; a step that needs logic beyond setting the field stays an action with a
  handler, and may still be guarded by `when` on its rule.

## Declined, with the sentence the reference gets

- Input on a transition (a rejection reason): "a transition sets the field and nothing else; a step with input is
  an action, and its handler may call the transition's update". An event handler on `articles.reject` can store
  the reason.
- Two transition blocks on one entity (two status axes): one per entity in this version; the second axis is an
  action with a handler.
- Transition history: the audit brief (`audit-and-webhooks.md`) records every transition as an audit entry when
  the entity has `audit: true`; no separate log.
- Guards on other fields: already expressible as a row condition on the transition's rule (`when body != null`).
- Automatic transitions on a timer without a rule: timers already run actions as the system; a transition is one.

## Proof

- Fixtures: blog FEAT-13 "editorial workflow" adds the block above on Article beside the existing `publish`
  action, to show that a transition and a handler-backed action coexist on one entity, with a scenario
  that submits as the author (200, in_review), approves as another user (403), approves as the editor (200,
  published, `published_at` set), approves again (409), rejects from published (409), archives as the author
  (200), and a timer that archives published rows thirty days after `published_at`. Todo TODO-8 "task flow":
  `status` todo → doing → done with `done` final, a board page on it, and a page test that a drag from done to
  todo is refused in both web backends.
- Eval cases: `fx-blog-13-editorial-workflow`, `fx-todo-8-task-flow`, and `blog2-review-workflow` re-expected on
  `transitions` with `any_of` keeping the action-based answer acceptable until the reference prefers transitions.
- Gate: as every round, then `built`.

## Size

Core: the block, the diff op, the IR flattening into actions, five diagnostics, the reference. One handler shape
per backend, the board drag mapping in the two web backends. Smaller than the scheduling round; most of the work
is the board.
