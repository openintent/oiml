# Design: field-level visibility

**Status: proposed 2026-11-09.** Not yet built. The grammar below is the design to review before the build.

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
otherwise the key is absent, not null, so a client can tell "no value" from "not for you". The rule takes the
predicates rules already have (`public`, `authenticated`, `role`, `owner`, `member`, paths, row conditions, `or`
and `and`); the entity's read rule still decides whether the row is seen at all, so a field rule can only narrow.

- Where it applies: get, list rows, includes that reach the entity, the detail pane and list columns of pages (a
  column the viewer cannot see is left out of the table and the form), and any payload the compiler builds from the
  row (events to queued handlers, webhooks, audit diffs). The handler context sees the full row; it is the server.
- Filters, sort and search on such a field are refused at compile time in this version (diagnostic), as they are
  for file fields: a filter on a value the caller cannot see would reveal it.
- Writes follow the entity's update rule, unchanged. A field the caller cannot read but the update rule lets them
  write is a diagnostic (warning): say `read_only` or widen the read rule.

## Mapping

- Core: `Field.read?: Rule`, resolved in the IR like the entity rules (`FieldIR.read: RuleIR | null`), with the same
  path resolution, so `withRuleValues` and `ruleRow` already cover what it needs. Diagnostics: `read` on a hidden
  field or a primary key; `read` on a field named in `list.filters`, `sortable` or `search`; the write-but-not-read
  warning.
- drizzle-next and hono-trpc-vite: the presenter gains a viewer argument, `present(row, viewer)`, and omits the
  keys whose rule refuses; list presenters evaluate per row, with path values resolved once per page by the
  existing subquery helpers. The web app's page components take the field list from `GET /api/auth/me`'s view of
  the resource (a new `fields` map per resource the viewer may see), so a column disappears rather than renders
  empty.
- gin-pgx: the same in the presenters package; `PresentWith(row, viewer)`.
- Scenarios: `expect.absent: [data.cost]` for a path that must not be present, alongside `body`; the matcher gains
  the key. The existing partial match cannot assert absence.
- OpenAPI: the property stays in the schema with "present only when: <rule>" in its description.
- Reference: one paragraph under Field, and the rule for choosing: a field some callers must never see is `hidden`;
  one that some callers see is `read:`.

## Declined, with the sentence the reference gets

- A `write` rule per field ("only owners may grant the owner role"): what a client may write into a field would
  then depend on who they are, which the reference says the model does not express. The reason is the row
  condition on the body: an update rule with `when` already freezes a field by state; a per-field, per-caller
  write rule needs the before and after values and a second grammar. Logged as the "role changes" gap it belongs
  to.
- Masking instead of omitting (`****`): a client cannot tell a mask from a value; absence is the contract.
- A field rule on the identity's `email`: allowed by the grammar; `auth.me` always returns the caller's own row in
  full.

## Proof

- Fixture: workspace WS-11 "budgets": `Project.budget` with `read: "member:team_id:admin"`; a member gets the
  project and `absent: [data.budget]`, the admin sees it, the member's list rows lack it, the member updates the
  budget (the update rule allows, so the warning fires and the fixture keeps the diagnostic in its expected
  output), the table page as the member has no Budget column (a page test in the web backends). Blog FEAT-12
  "author contact": `User.phone` with `read: "owner:id or role:admin"`; another user's `auth.me` is unaffected.
- Eval cases: `fx-ws-11-budgets`, `fx-blog-12-author-contact`, and the manager-cost ask of r6 promoted.
- Gate: as every round: conformance 9/9, snapshots, `--resume` without loss, the cluster gone, `built`.

## Size

Core: the key, the IR field, four diagnostics, the reference. The viewer argument through every presenter site on
the three backends, the `fields` map on `auth.me`, the page column filter in the two web backends, the `absent`
matcher. About the size of the hidden-rows round.
