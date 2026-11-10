# Design: money, sequences, sealed fields and typed JSON

**Status: sequences and money built 2026-11-10** (the first half of round B6 of the road to 1.0.0); sealed
fields and typed JSON are the second half and are not built yet. Proposed on 2026-11-09 and built without a design
review stop, so every decision is the owner's to review; they are numbered under "Decisions of the first half",
and the ones that departed from the design below or from what the round was recommended to do say so. What changed
from the design while building: the database assigns a sequence's number in a `BEFORE INSERT` trigger, where the
design had the resource module do it in `create`; a create that rolls back leaves no hole, because the counter is
written in the create's transaction (the design said it would leave one, with the same statement); the counter
table is a database object the web role has no grant on, not an entity; the fields of a scope are required and
left out of update; a sequence column is `varchar(255)`, not `text`; a `currency_field` is a required enum of ISO
4217 codes, not "a string or enum"; an update that changes a currency must send the amounts in it; the Go backend
carries an amount as a `string` read through `::text`, not as `pgtype.Numeric`; a rule's `when` and a count's
`where` do not test an amount; the workspace intent is WS-16, since WS-12 was taken.

Four field constructs, each small, each with one mapping on the three backends.

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

_Second half of round B6: not built yet. The design below is as proposed._

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

_Second half of round B6: not built yet. The design below is as proposed._

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

- Fixtures (as proposed; the first half's proof as built is below): workspace WS-12 "invoices": `Invoice` with `number` as a sequence scoped by `team_id`, `total` as
  money in the team's currency, and a scenario in which two teams each create two invoices and see `INV-000001`
  and `INV-000002` apiece, a list filtered by number, and a `total` of `"19.9900"` echoed as a string. Blog FEAT-14
  "integrations": `User.webhook_secret` sealed and `hidden`, read by an overlay handler, and `User.preferences` as a
  shape with a 400 on a wrong theme. The snapshot shows the counter table and the `bytea` column.
- Eval cases: `fx-ws-12-invoices`, `fx-blog-14-integrations`, and the r5 reference-number ask promoted.
- Gate: as every round, then `built` for "sequences and reference numbers" and the three new entries.

As built for the first half: workspace WS-16 "invoices" (`Invoice.number` a sequence scoped by `team_id`, `total`
money in the row's `currency`, `fee` money in USD, `Team.invoice_count`), under `isolation: database`, with the
scenario above extended (refused creates that take no number, a nineteen-digit total, the currency without the
amount, a hole after a delete); `packages/core/test/sequence.database.test.ts`; `packages/cli/test/money.test.ts`;
eval cases `fx-ws-16-invoices`, `empty-order-numbers` (the r5 reference-number ask) and `empty-quotes-money`. The
blog intent of the second half takes the next free number there (FEAT-14 and FEAT-15 are taken).

## Decisions of the first half (sequences and money), 2026-11-10

Sequences:

1. **The database assigns the number.** One trigger function and one `BEFORE INSERT FOR EACH ROW` trigger per
   sequence field, planned and dropped with the other database objects (`sequenceObjects` in `databaseObjects`),
   so drift compares them. A cascade is not a handler, and neither is a seed or a handler of the user's: a row any
   of them inserts gets its number too. The insert's `RETURNING` hands the number back, so no backend has a line
   of sequence code. (As recommended; the design had the resource module assign it.)
2. **A create that rolls back leaves no hole.** The trigger takes the counter with `INSERT ... ON CONFLICT DO
UPDATE ... RETURNING`, which holds the counter's row until the transaction ends and is undone with it. So two
   creates in one scope never share a number, the second waits for the first, and a scope's numbers are
   consecutive in commit order; a hole appears only where a row was deleted later, and a deleted number is not
   given again. The design, and the round's prompt, expected holes after rollbacks; with the design's own
   statement there are none. The alternative that leaves holes and never waits is a PostgreSQL sequence, which
   cannot be made per scope value. The price: creates in one scope serialize, which is why a scope is usually the
   tenant, and a transaction of the user's own that creates in two scopes takes their counters in the order it
   writes (two such transactions the other way round can deadlock, as with two ordered parents).
3. **The counter table is an object, not an entity.** `osl_sequences ("sequence", "scope", "last")`, kind `table`
   among the database objects: made with the first sequence, dropped with the last, never made again in between
   (the planner does not remake a table), expected by `osl drift`. No backend sees it. The scope is the values
   as a JSON array in text (`jsonb_build_array(NEW.team_id)::text`), so no two scopes spell alike.
4. **Under `isolation: database`** the web role has no grant on the counter table: a counter scoped by tenant says
   how many rows a tenant made, and no policy could let a caller add to a counter without letting it read one. The
   functions are `SECURITY DEFINER` with `EXECUTE` revoked from everyone and touch exactly the counter the new row
   names. The trigger fires before the policy's check, so a row the policy refuses takes its statement and the
   counter's step back: a refused insert tells nothing and leaves no hole. A sequence with an empty scope is one
   counter for the table. On a tenant table that tells every tenant how many rows the others made (its own
   numbers skip by what they created), so **M181** warns unless the scope names a relation to the tenant or to a
   tenant table's row, and says which field to scope by. (As recommended.)
5. **The trigger overwrites whatever the writer put in the column**, as a position's does. An `UPDATE` of the
   number by server code is not policed; the unique constraint stands behind it.
6. **A scope names required fields a row keeps**, and update leaves them out (**M180**, **M183**), like the parent
   of an ordered row since B2: the number was counted where the row was created, and a row moved into another
   scope could meet its own number there. Allowed: a relation, an enum, a string, an integer, a uuid, a boolean, a
   date. `UNIQUE (scope..., number)` is in the entity's uniques.
7. **A sequence is a string to everything that reads it**: IR scalar `string` with `ColumnIR.sequence`,
   `varchar(255) NOT NULL DEFAULT ''` (the design said `text`). Lists, filters, sort, search and the display
   column treat it as the short string it is, and an entity whose first string is its number is named by it.
8. **Trigger order.** `osl_sequence_<column>` fires after `osl_count_hold` and `osl_order_assign` (name order), so
   on an ordered or counted table every insert takes the parent first and the counter last. B2's and B3's database
   tests run their loads again with a sequence on the ordered and on the counted table (B2's heavy load too,
   `OSL_ORDER_ROUNDS=400`). One finding: with a table-wide counter on the counted table B3's control has nothing
   to show, since every insert waits for the one before it; it is skipped in that variant, with the reason.
9. **Migrations.** A sequence arriving on a table with rows numbers them scope by scope in `created_at`, key order
   (a table rewrite, `backfill_sequence`) before the unique constraint and seeds the counters after the table
   exists; a renamed table or field moves its counters; a changed scope reseeds each new scope after the largest
   number its rows carry and warns that the migration fails if two rows of a new scope share a number; a dropped
   field takes its counters.
10. **Field visibility (B5).** `read:` is allowed on a sequence and M172 holds for it as for any field; M175 is not
    raised for it (no write carries a number, so none can probe one). The default order of a list is unchanged,
    so there was nothing to treat like `created_at`: a number orders a list only where the model says so.

Money:

11. **A scalar of its own.** `money` beside `decimal` in the IR, with `ColumnIR.money` (the currency, and the
    bounds as decimal strings), so that no branch written for `decimal` (which accepts JSON numbers and compares
    bounds as floats) is taken by accident. `ColumnIR.validate` stays numeric.
12. **A decimal string in both directions, and nothing else in.** `^-?\d{1,15}(\.\d{1,4})?$`: a JSON number
    answers 400 and is never converted, a fifth fraction digit answers 400 and is never rounded. Answers are the
    text PostgreSQL prints for `numeric(19, 4)`, always four fraction digits. Every place a value passes was read
    and is listed in `docs/backends.md` ("Money, a decimal string end to end"): request parsing, bounds, the
    driver, the presenter, filters and sort, includes, events, OpenAPI, the generated tests, the page forms, the
    harness's bodies and its fuzz probes.
13. **Go carries a `string`, read as `::text`.** The design said `pgtype.Numeric`. A string needs no conversion
    in the handler, and selecting the column as text makes the answer PostgreSQL's own spelling instead of the
    driver's rendering of a numeric.
14. **`currency_field` names a required enum of ISO 4217 codes on the same entity (M182).** The design allowed a
    string; nothing would check a free string is a code, and an enum gives the forms a select and a tile its
    groups. A currency read through a relation is declined: an invoice keeps its currency when its team changes
    theirs.
15. **An update that changes the currency sends the amounts in it**, or answers 400 naming the amount; sending the
    currency unchanged, or with every amount, is accepted, and a row whose amount is null has nothing to carry.
    The check runs in the update handler on the row it loaded, after the rule. **M184** warns where an update can
    write the currency and not an amount in it.
16. **Mixed currencies.** A filter or a sort on an amount compares numbers; the reference tells a model with a
    `currency_field` to filter by the currency as well. A tile may group by the currency field (rows per
    currency) and never by an amount, which M089 already says; sums stay declined.
17. **No rule's `when` and no count's `where` tests an amount**: the generated rule evaluators compare JavaScript
    and Go values, and an exact comparison for amounts is not built. It is refused with the existing message.
18. **A money field may be an action's input or result** with `currency:`; `currency_field` and a sequence are
    refused there (M090).

Both:

19. **Pages.** An amount is a text input (`inputMode="decimal"`, the pattern) with its currency beside it, the
    field's code or the form's currency value; lists and detail panes show `formatMoney(value, currency)`, which
    groups digits and trims zeros on the string. A sequence is shown and has no input. Seen in Chromium on both
    web backends.
20. **Diagnostics M180 to M184**; M064 for a sequence named in `create.fields` or `update.fields`, M090 in an
    action's fields. M185 to M189 are left for the second half.
21. **The harness.** The fuzz walk sends every money field as a JSON number, with five fraction digits, sixteen
    whole digits, an exponent, a separator, a currency sign and one step outside each bound. Its first run found
    a 500: Zod runs a refinement after a failed pattern, and the bound's comparison threw on `"twelve"`; the
    validator now checks the shape first. The order walk sends eight creates at once into one scope of every
    numbered entity and wants eight numbers in a row.

## Size

Core: two types, six keys, the counter table in migrations, seven diagnostics, the reference. Validation,
presentation and form work in the shared TypeScript generators and the Go packages. Together about the size of the
pages round; each piece can ship alone, sequences first.
