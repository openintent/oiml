# Design: scheduled and recurring work

**Status: built 2026-11-09.** What changed from the design below while building: the test hooks live at
`/api/osl-hooks/*` rather than `/api/_osl/*`, because Next.js treats a folder with a leading underscore as
private and never routes it; a `schedules.run` step may only name an action a schedule runs (M136), so the
route's 400 for anything else is not exercised by a scenario; a timer's action may take no required input
(M133), since a timer passes none; the Go events package always defines `RunQueued` once the queue exists, with
or without events; schedule and timer queues on pg-boss are named `schedule.<name>` and `timer.<name>`, because
pg-boss refuses a colon. Proof: blog FEAT-9 (scheduled publishing and the daily digest), workspace WS-6 (due
reminders through the mailbox), todo TODO-7 (the nightly clear), conformance 9/9 on all backends with the
in-process workers, eval cases `fx-blog-9-scheduled-publishing`, `fx-ws-6-due-reminders`,
`fx-todo-7-nightly-clear`, `blog5-overdue-review`, `ws2-delivery-overdue` and `blog2-forum-autolock`.

The top open gap after the pages round: three cases in every generated round, eleven lines in all. This note turns
them into constructs with a deterministic mapping on all three backends, gives the tests a clock, and declines the
rest. It is the design to review before the build; the grammar is permanent.

## What was asked, in the agents' words

| Ask                                                                                                                                               | Where                      | Verdict                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| "Running the overdue check automatically every day has no schedule construct; the handler must be triggered by an external scheduler or an admin" | r1-04, r2-01, r3-02, r4-03 | construct: `schedules`, a cron that runs a global action                                                                                |
| "Automatic go-live at the scheduled time: `publish_at` is stored, but a piece only goes live when its publish action is called"                   | r1-03, r3-10, r4-07        | construct: `timers`, a row action that runs when a datetime field (plus an offset) passes                                               |
| "Automatic locking of a thread after 60 days without new replies"; "flag overdue 48 hours after assignment"; "clear tasks done for 30 days"       | r1-09, r4-08, r4-03        | construct: `timers` with `after`                                                                                                        |
| "Scenarios cannot back-date activity or advance the clock, so only the sweep's access rule is tested"                                             | r1-09, r4-08, r3-10        | construct: a clock for scenarios, `timers.run` and `schedules.run` steps with `{now+49h}`                                               |
| "The model cannot declare or test that an email was sent"                                                                                         | r1-04, r2-01               | construct: `emails.sent` step over the capture mailbox                                                                                  |
| "A tile filter cannot express a due date before today"; "comparing completion time against now minus 30 days"                                     | r2-04, r4-03               | separate construct, comparison filters with `now`; named here, designed next                                                            |
| "The overdue flag cannot be computed from the due date"                                                                                           | r1-04                      | a timer sets a read_only flag; no computed field                                                                                        |
| "Refusing replies to a locked thread: a create rule cannot depend on the related thread's field"                                                  | r1-09                      | a row condition through a relation (`when article_id.locked = false`); a small extension of row conditions, noted for the rules backlog |

## Constructs

Both kinds of work run on the job queue the backends already have for queued events: pg-boss on the TypeScript
backends, River on Go. Both support cron schedules and jobs that start at a given time, so nothing new runs in
production that does not run today for queued events. A model with a schedule or a timer gets `jobs: { queue: true }`
in the IR, as a queued event does.

### 1. Schedules

```yaml
schedules:
  - { cron: "0 7 * * *", action: send_reminders } # UTC; a global action with no required input
  - { cron: "*/15 * * * *", action: sweep_overdue, input: { grace_hours: 48 } } # literal input when the action takes some
```

A schedule runs a global action's handler as the system: no session, no access rule, the input given here (or none).
The handler is the one `osl implement` writes and the one scenarios already call through `actions.<name>`, so a
schedule adds no new kind of handler. The payload tells the handler when it was due (`ctx.scheduled_for`).

- Grammar: five-field cron, UTC. `action` must be a global action; `input` must satisfy its input schema with
  literals, and every required input must be given (M131).
- Validation: M130 cron does not parse; M131 action unknown, not global, or input missing or wrong.
- IR: `ScheduleIR { name, cron, action, input }`; `ir.jobs = { queue: true }`.
- drizzle-next and hono-trpc-vite: at worker start `boss.schedule("schedule:<name>", cron, { input })` and a
  worker for that queue calls the action's handler with `{ input, row: undefined, session: null, db, now }`.
- gin-pgx: a River `PeriodicJob` per schedule with a cron schedule, inserting a `ScheduleArgs` job the worker
  runs through the actions registry with a nil session.
- The web role only enqueues; `OSL_ROLE=worker` runs them, as for queued events.

### 2. Timers

```yaml
timers:
  - { on: Article, at: publish_at, run: posts.publish, when: "published = false" }
  - { on: Delivery, at: assigned_at, after: 48h, run: deliveries.flag_overdue, when: "status = assigned" }
  - { on: Thread, at: last_reply_at, after: 60d, run: threads.lock, when: "locked = false" }
```

When a row is created or updated and `at` is set, a job is scheduled for `at + after`. When it fires, the worker
reloads the row and runs the row action's handler as the system only if the row still says so: the field still
gives the same due time (a later edit scheduled a newer job, which will fire instead) and the `when` condition still
holds. Jobs are wake-ups; the row is the truth, so a changed date needs no cancellation and a fired job cannot act
on stale data. The handler sees `ctx.now`, the time the timer was due.

- Grammar: `on` an entity, `at` a datetime field of it, `after` a duration (`15m`, `48h`, `30d`; default none),
  `run` a row action of a resource over the entity, `when` a row condition in the rules' spelling.
- Validation: M132 field missing or not a datetime; M133 `run` is not a row action over `on`; M134 duration
  does not parse; `when` reuses the row-condition checks (M032, M033).
- IR: `TimerIR { name, entity, column, afterSeconds, action, when? }`.
- Generated resources: after a create or update that sets the column, the TS resources and the Go resources
  enqueue (`boss.send("timer:<name>", { id, due }, { startAfter: due, singletonKey })`; River `ScheduledAt: due`
  with unique args). A row action's handler that changes the field (publish clears nothing; reschedule sets a
  new date) goes through the same path because it writes through the resource layer.
- Worker: loads the row by id, recomputes `due` from the current field; skips when the field is null, the due
  time differs, or `when` fails; otherwise calls the handler with `{ input: {}, row, session: null, db, now }`.
- Handlers written by `osl implement` get one more guide sentence: use `ctx.now`, not the wall clock.

### 3. A clock for scenarios, and the mailbox

Time is an input, so scenarios can state it. Three step kinds join `auth.*` and `files.*`:

```yaml
- op: timers.run # run every timer due at that moment, as the worker would
  body: { now: "{now+49h}" }
  expect: { status: 200, body: { data: { ran: 1 } } }
- op: schedules.run # run one schedule's action now
  body: { schedule: send_reminders, now: "{now+1d}" }
  expect: { status: 200, body: { data: { ran: 1 } } }
- op: emails.sent # the capture mailbox since the scenario began
  query: { to: bob@example.com }
  expect: { status: 200, body: { data: [{ subject: "Reminder: Spring fair" }] } }
```

`{now}` and `{now+2h}` / `{now-3d}` resolve in step bodies and expectations to ISO timestamps, so a scenario can
create a row due in the past or the future without a real wait. The steps call test routes
(`POST /api/osl-hooks/timers/run`, `POST /api/osl-hooks/schedules/run`, `GET /api/osl-hooks/emails`) that the backends mount only
when `OSL_TEST_HOOKS=1`, which the conformance harness and `osl verify --base-url` set; in production the routes do
not exist. `timers.run` evaluates every timer against the given time with the same code path the worker uses, so a
scenario proves the worker's behaviour, not a copy of it.

- Validation: M135 a `timers.run` step in a model without timers; M136 `schedules.run` naming an unknown schedule;
  `emails.sent` needs the email module (any provider or an identity entity).
- Both TypeScript test clients and the Go test client learn the three ops; the Go and TS servers each mount the
  three routes behind the flag.

## Declined, with the sentence the reference gets

- Live push and websockets: still `refresh`.
- Computed fields from dates (an `overdue` boolean derived from `due_on`): a timer sets a read_only flag; derived
  columns stay out.
- Comparison filters and rules against `now` ("due before today", "upcoming events"): a list construct, designed
  next as `filters: [status, { field: due_on, ops: [before, after] }]` with the `now` keyword; until then say so.
- Conditions through a relation in rules (`when article_id.locked = false`): a rules extension; logged in the
  backlog under rule conjunctions and paths rather than built here.

## Proof

- Fixtures: blog FEAT-9 adds `Article.publish_at`, a timer that publishes at that time while unpublished, a daily
  `send_digest` schedule, and a scenario that creates an article due in the past, runs the timers at `{now+1h}`,
  reads it as published, runs the digest schedule and checks the captured email. Workspace WS-6 adds
  `Task.due_on` reminders: a timer with `after: 0` on `due_on` that emails the assignee through `tasks.remind`, a
  scenario with `{now-1h}`, `timers.run` and `emails.sent`. Todo TODO-7 adds a nightly `clear_done` schedule and
  proves it with `schedules.run`.
- Eval cases: `fx-blog-9-scheduled-publishing`, `fx-ws-6-due-reminders`, `fx-todo-7-nightly-clear` with the
  fixtures' diffs as oracles; `blog5-overdue-review` (a review that waits more than seven days is flagged) and the
  generated asks `gen-r1-09-gardening-forum-autolock` and `gen-r4-08-delivery-proof-tracker` promoted into the corpus.
- Gate: conformance 9/9 on a real queue (the harness starts the app with the worker role in-process, as today),
  snapshots, the oracle grader, rounds 1 to 4 graded again with `--resume` losing nothing, and a fresh round no
  longer reporting "scheduled and recurring work"; then `built` in the backlog.

## Size

Core: `schedules` and `timers` sections, six diagnostics, two IR types, three step kinds and `{now}` templates in
the step compiler, reference. Three backends: queue scheduling at worker start, timer enqueue in create and update,
the worker's timer path, the three test routes, `now` in the action context, the test clients. Three fixtures,
five eval cases, snapshots. Larger than the pages round, about the rules round plus the handler-writing step.
