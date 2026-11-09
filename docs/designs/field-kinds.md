# Design: money, sequences, sealed fields and typed JSON

**Status: proposed 2026-11-09.** Not yet built. Four field constructs, each small, each with one mapping on the
three backends. The grammar below is the design to review before the build.

A field added to a hand-written application of OSL's shape lands in a dozen places: the column, the validation
schema, the write service, the forms, the list, the detail, the copy, the audit catalog, the event payload, the
webhook decision, the public API projection, the import and export mappings, the reports. One of the applications
surveyed for these notes lists sixteen such sites in order for its central entity and made four of them exhaustive
type maps so that a forgotten site fails the type check; the worked example touched forty-two files. OSL already
emits those sites from one declaration. What it lacks are four field kinds the sites keep needing: an amount of
money that no float ever touches, a reference number that counts per tenant, a value encrypted at rest that never
leaves the row, and a JSON column with a declared shape.

## 1. Money

```yaml
price: { type: money, currency: USD } # a fixed currency
amount: { type: money, currency_field: currency } # the row's currency field (a string or enum of ISO 4217 codes)
```

Stored as `numeric(19, 4)`; on the wire a decimal string (`"12.3400"`, never a number), validated as a decimal with
at most four fractional digits and the currency's exponent for display; `validate.min` and `max` take decimal
strings. Filters and sort work; tiles with `group_by` count rows, not sums (declined below). The two TypeScript
backends carry it as a string end to end and the forms render a decimal input with the currency; the Go backend
uses `pgtype.Numeric` and a string on the wire. Seven lint rules in one of the surveyed applications exist only to
keep floats away from money; a type makes them unnecessary.

## 2. Sequences

```yaml
number: { type: sequence, prefix: "INV-", scope: [team_id], width: 6 } # INV-000042, counted per team
```

A `read_only` string the server assigns on create, inside the create's transaction, from a counter table the
compiler adds (`osl_sequences`: entity, field, scope key, next) through `INSERT ... ON CONFLICT DO UPDATE ...
RETURNING`, so two concurrent creates never share a number and a rolled-back create leaves a hole, which is the
accepted behaviour of every invoice numbering scheme. `scope` names fields of the entity (usually the tenant
relation; empty for a global counter); `prefix` and `width` format it; unique per scope is implied and indexed.
Filterable, searchable and sortable as a string. This is the "sequences and reference numbers" gap of the backlog.

## 3. Sealed fields

```yaml
api_token: { type: string, sealed: true }
```

Encrypted at rest with AES-256-GCM under `OSL_SEAL_KEY` (the generated README and `.env.example` name it; the app
refuses to start without it when the model has a sealed field), stored as `bytea`, decrypted only by the presenter
for a caller the rules allow. A sealed field never enters an event payload, a webhook, an audit diff, a log line, a
seed dump, a search, a filter or a sort (diagnostics for the last three), and `hidden` combines with it for a value
the API never returns at all but a handler may read. Both TypeScript backends and Go have AES-GCM in their standard
library; the key format and nonce layout are fixed by the reference so a database moves between backends.

## 4. Typed JSON

```yaml
settings:
  { type: json, shape: { theme: { type: enum, enum_values: [light, dark] }, digest: { type: boolean, default: true } } }
```

`shape` is a map of Field without storage options, the same spelling as an action's input. The value is validated
on write against it (400 with the path of the offending key), typed on read (a Zod object and a Go struct), and
rendered in forms as a group of inputs. Without `shape`, `json` stays what it is today. Nested shapes and arrays
of shapes are allowed to one level in this version.

## Mapping

- Core: `Field.type` gains `money` and `sequence`; `Field.currency`, `currency_field`, `prefix`, `scope`, `width`,
  `sealed`, `shape`. The IR resolves each to a column (`numeric`, `text`, `bytea`, `jsonb`) and marks the field's
  presentation (`wire: "decimal" | "sealed" | shape`). `planMigration` adds the counter table once and the unique
  index per sequence. Diagnostics: a currency that is not a code, a `currency_field` that is not a string or enum
  of codes, a sequence `scope` naming a non-field, a sealed field in filters, sort or search, a shape key with
  storage options.
- drizzle-next and hono-trpc-vite: the validation generator emits the decimal-string refinement, the shape object
  and the sealed exclusions; the resource module assigns sequences in `create`; the presenter decrypts; the forms
  render money, sequence (read-only) and shape groups. The seal helper lives in `@osl/ts-common`.
- gin-pgx: the same in the validation, resources and presenters packages, with `crypto/aes` and `cipher.NewGCM`.
- OpenAPI: money as `string` with `format: decimal` and the currency in the description; a sequence as a read-only
  string with its pattern; a sealed field as its declared type; a shape as a nested object schema.
- Reference: four short paragraphs under Field and the rules for choosing: an amount is `money`, never `decimal`;
  a human-facing number that counts is `sequence`, never a uuid shown to people; a secret the server reads back is
  `sealed`, a password is never a field (credentials own it); a column with known keys is a `shape`.

## Declined, with the sentence the reference gets

- Sums and averages on money in tiles and lists: with the counts brief's `count_of`; "a total is a `read_only`
  field a handler or a trigger keeps, or a sum in a custom page".
- Currency conversion, rounding modes beyond half-even at four places, and minor-unit integers on the wire: the
  decimal string is the contract.
- Resetting sequences per year or per prefix segment with a date: `scope` names fields; a `year` field set on
  create by a handler scopes it.
- Key rotation for sealed fields: an operations step outside the model; the reference names the command to come.
- Searchable encryption: "a sealed field cannot be searched; keep a separate searchable field if one is needed".

## Proof

- Fixtures: workspace WS-12 "invoices": `Invoice` with `number` as a sequence scoped by `team_id`, `total` as
  money in the team's currency, and a scenario in which two teams each create two invoices and see `INV-000001`
  and `INV-000002` apiece, a list filtered by number, and a `total` of `"19.9900"` echoed as a string. Blog FEAT-14
  "integrations": `User.webhook_secret` sealed and `hidden`, read by an overlay handler, and `User.preferences` as a
  shape with a 400 on a wrong theme. The snapshot shows the counter table and the `bytea` column.
- Eval cases: `fx-ws-12-invoices`, `fx-blog-14-integrations`, and the r5 reference-number ask promoted.
- Gate: as every round, then `built` for "sequences and reference numbers" and the three new entries.

## Size

Core: two types, six keys, the counter table in migrations, seven diagnostics, the reference. Validation,
presentation and form work in the shared TypeScript generators and the Go packages. Together about the size of the
pages round; each piece can ship alone, sequences first.
