# Design: money, sequences, sealed fields and typed JSON

**Status: built 2026-11-10** (round B6 of the road to 1.0.0, in two halves: sequences and money, then sealed
fields and typed JSON with a shape per enum value). Proposed on 2026-11-09 and built without a design review stop,
so every decision is the owner's to review; they are numbered under "Decisions of the first half" and "Decisions
of the second half", and the ones that departed from the design below or from what the round was recommended to
do say so. What changed from the design below while building. Sequences and money: the database assigns a
sequence's number in a `BEFORE INSERT` trigger, where the design had the resource module do it in `create`; a
create that rolls back leaves no hole, because the counter is written in the create's transaction (the design said
it would leave one, with the same statement); the counter table is a database object the web role has no grant on,
not an entity; the fields of a scope are required and left out of update; a sequence column is `varchar(255)`,
not `text`; a `currency_field` is a required enum of ISO 4217 codes, not "a string or enum"; an update that
changes a currency must send the amounts in it; the Go backend carries an amount as a `string` read through
`::text`, not as `pgtype.Numeric`; a rule's `when` and a count's `where` do not test an amount; the workspace
intent is WS-16, since WS-12 was taken. Sealed fields and typed JSON: a sealed field without `read:` is returned
to nobody (the design left the default open); the stored layout has a version byte and is bound to the table and
the column, so a sealed field cannot be renamed and no field becomes sealed or stops being sealed; the key is 64
hexadecimal characters; a value that does not open answers 500 for a caller the rule allows, never an absent key;
a shape takes neither money nor an array of shapes, which the design allowed ("arrays of shapes to one level"); a
read does not check a stored value against its shape, and the Go row keeps the JSON as it is stored, with a struct
per shape beside it for handlers, where the design said "typed on read (a Go struct)"; the roadmap's shape per
enum value is `shape_by`, held on every write by the handlers on the loaded row; the fixture is one blog intent,
FEAT-16, around a new `Integration` entity, where the design named FEAT-14 and `User.webhook_secret`. Since then:
the hardening pass of 2026-11-10 refuses, with M189, a required sealed field and a required field with `shape_by`
on the identity (and every other field of the identity that must hold a value and that no sign-up fills):
`auth.register` takes neither, so nobody could have registered.

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

```yaml
secret: { type: string, sealed: true } # written through the API, returned to nobody; a handler opens it
token: { type: string, sealed: true, read: "owner:owner_id" } # returned to its owner and to nobody else
```

Encrypted at rest with AES-256-GCM under `OSL_SEAL_KEY` (the generated README and `.env.example` name it; the app
does not start without it when the model has a sealed field), stored as `bytea`, decrypted only by the presenter
for a caller the field's `read:` rule allows, and for nobody when the field has none. A sealed field never enters
an event payload, a log line, a search, a filter or a sort, and no rule tests it (diagnostics); `hidden` combines
with it for a value the API neither accepts nor returns and only a handler writes and reads. Both TypeScript
backends and Go have AES-GCM in their standard library; the key format and the stored layout are fixed by the
reference implementation in `@osl/core` (`seal.ts`), with fixed vectors in the tests of all three, so a database
moves between backends with its key. Webhooks and audit diffs are milestone C's: a sealed field is in neither,
whoever they go to (decision 9 below).

## 4. Typed JSON

```yaml
settings:
  { type: json, shape: { theme: { type: enum, enum_values: [light, dark] }, digest: { type: boolean, default: true } } }
config: # what it holds follows the row's kind
  type: json
  shape_by:
    kind:
      webhook: { url: { type: string, required: true }, retries: { type: integer, default: 3 } }
      slack: { channel: { type: string, required: true } }
```

`shape` is a map of fields without storage options, the same spelling as an action's input. The value is
validated on write against it (400 with the path of the offending key), typed where the code reads it (a Zod
object and the column's TypeScript type; a Go struct a handler decodes into), and rendered in forms as a group of
inputs. Without `shape`, `json` stays what it is today. One nested shape is allowed per key; an array inside a
shape holds scalars. `shape_by` names a required enum field of the same entity and gives each of its values a
shape: the backlog's "conditional validation", from the Notion exercise, where a block's content depends on its
type. Every write that touches the enum or the value is held to the pair.

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

As built for the second half: core has `Field.sealed`, `shape` and `shape_by`, `ColumnIR.sealed`, `shape` and
`shapeBy` (the column's `type` stays what was declared: a string, a `json`), `seal.ts` (the format's reference
and its vectors) and `shapes.ts` (the keys' IR and the reference validator the harness holds the backends to);
`sqlType` and the drift check answer `bytea` for a sealed column, and a shape is no step of a migration. The
TypeScript backends share `generated/seal.ts` (`seal`, `unseal`, `atRest`), the Zod objects in
`generated/validation.ts`, the value types in `generated/db/schema.ts`, the presenter's sealed branch and the page
forms; each resource module seals a write before its hook and holds a `shape_by` value to its row. gin-pgx has
`generated/seal` (with its test of the vectors), `validation.Shape`, a struct per shape in `generated/models` and
the same two steps in each handler. Under `isolation: database` nothing is added to the database: a sealed
column is a `bytea` and a shaped one a `jsonb` on a table whose policies are B1's, no trigger, function or policy
names either, and the presenter that opens a value runs in the app for a row the policy already let through.

## Declined, with the sentence the reference gets

- Sums and averages on money in tiles and lists: with the counts brief's `count_of`; "a total is a `read_only`
  field a handler or a trigger keeps, or a sum in a custom page".
- Currency conversion, rounding modes beyond half-even at four places, and minor-unit integers on the wire: the
  decimal string is the contract.
- Resetting sequences per year or per prefix segment with a date: `scope` names fields; a `year` field set on
  create by a handler scopes it.
- Key rotation for sealed fields: not built; the stored layout's version byte is where a later round adds it.
- Searchable encryption: "a sealed field cannot be searched; keep a second field beside it that may be compared".
- A sealed number, date or JSON value, a key per tenant or per row, a value the server cannot read: "say so in
  not_delivered".
- Renaming a sealed field or its entity, and sealing a field that exists: "add a new field, move the values in a
  handler, remove the old one"; a migration has no key.
- Money, a file, a relation, `sealed` and `read:` on a key of a shape: each is a field of its own; "a rule per key
  is not offered: `read:` on the field covers the whole value".
- An array of shapes: "a list of objects is an entity of its own with a relation, and a `position` when it is
  ordered".
- A shape chosen by two fields, by a related row's field, or a key required only when another key has a value;
  filtering, sorting or indexing by a key inside the value: "say so in not_delivered".
- `shape_by` on the field of `transitions`: refused (M187) until a transition can carry the new value.

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

As built for the second half: blog FEAT-16 "integrations, preferences and sealed secrets": `Integration` with
`config` as `shape_by` over `kind` (webhook, slack, email), `secret` sealed without `read:`, `token` sealed and
read by its owner, a `sign` action whose overlay handler opens the secret on all three backends, an
`Integration.created` event whose overlay handler fails if a sealed value reaches its payload;
`User.preferences` with a shape and a nested shape, and `User.recovery_code` sealed on the identity. A 32-step
scenario. The leak walk writes every sealed field through the API as every caller, opens the stored bytes with the
reference, stores bytes of its own for the app to read, stores bytes that cannot open and wants 500, and reads the
app's log; the fuzz walk bends every key of every shape and wants a 400 that names the key, then stores a value
that misses its shape straight into the database and wants the read to answer it as stored. Before the tests the
harness starts the app without the key and with a short one and wants it to stop.
`packages/core/test/sealed-and-shapes.test.ts`; `packages/conformance/test/sealed.test.ts` (the generated
TypeScript and Go seal code run against the vectors and against each other, through a `bytea` column of a real
database); eval cases `fx-blog-16-integrations`, `empty-blocks-by-type` (the Notion ask) and
`empty-service-credentials`.

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

## Decisions of the second half (sealed fields, typed JSON, a shape per enum value), 2026-11-10

Sealed fields:

1. **`read:` defaults to nobody.** A sealed field without `read:` is written through the API and returned to no
   caller; `read:` names who gets it back. B5's notes offered "required, or `none`": a default keeps the safe
   meaning the short spelling, and a signing secret, the common case, is exactly that. In the IR a sealed column
   that is not hidden always carries `read` (`{ kind: "none" }` here), so everything B5 built for a field with a
   read rule holds for it: the presenter takes the viewer, the key is absent for a caller the rule refuses, the
   contract lists the property as optional, the session's `fields` answers for it. M174 (a writer the read rule
   refuses) is not raised for a sealed field: writing what one does not read back is what it is for.
2. **Opened in the presenter, inside the rule's branch, and never for the server.** `viewer !== SERVER &&
   reads(rule, viewer, row)` (TypeScript), `viewer != Server && viewer.Reads(...)` (Go), with the decryption as
   the assigned expression, so it runs only for a viewer the rule allows on that row. The server as a viewer
   carries no sealed value: an event's payload has none, and neither has the user a session keeps for its rules.
   So nothing may test one: a rule's `when`, a field rule's, a count's `where` and a timer's `when` are refused
   where conditions are checked (M033, M154, with "the field is sealed"), and list filters, `sortable`, `search`,
   `order`, `unique`, an index (M185) and a sequence's scope (M180) where they are named. (As recommended.)
3. **A handler reads it by name.** A row a handler loads holds the stored bytes (`Uint8Array`, `[]byte`), so no
   plaintext is there to return or log by accident and the compiler refuses a string where bytes belong:
   `unseal("integrations.secret", row.secret)` and `seal(...)` from `generated/seal.ts`,
   `seal.Open(seal.IntegrationsSecret, row.Secret)` and `seal.Seal(...)` in Go. A hook sees the bytes too: a write
   is sealed before `beforeCreate` and `beforeUpdate` run. `osl implement`'s conventions say so.
4. **The format is the contract.** `0x01 || nonce (12 random bytes) || ciphertext || tag (16 bytes)`, AES-256-GCM;
   the associated data is `0x01` followed by `<table>.<column>` in UTF-8, so a value copied into another column
   or table does not open, nor one whose version byte was changed. `@osl/core`'s `seal.ts` is the reference; four
   fixed vectors, computed apart from it, are in the reference's test, in a generated test of each TypeScript
   project (`generated/tests/00_sealed_values.test.ts`) and in `generated/seal/seal_test.go`. (As recommended.)
5. **The row is not bound.** A row's key is often assigned by the database on insert (an identity, a default
   uuid), so the value would have to be sealed after the insert in a second statement, in every handler of the
   user's as well. A value copied from one row's column into another row's same column therefore opens. The
   version byte leaves room for a layout that binds the key.
6. **A sealed field keeps its name and its kind.** Since a value is bound to its table and column, `applyDiff`
   refuses `rename_field` on a sealed field, `rename_entity` on an entity that has one (unless the entity names
   its `table:`, which a rename leaves alone), and an `update_field` that makes a field sealed or not: a
   migration has no key, so it can neither re-seal nor open what is stored. The sentence says what to do
   instead. Not asked for; it follows from decision 4.
7. **The key is 64 hexadecimal characters in `OSL_SEAL_KEY`, and there is no default.** Hexadecimal has one
   spelling in both languages; Node's base64 decoder accepts what Go's refuses. No generated file or snapshot
   holds a key: `.env.example` has the empty variable, the compose files require it
   (`${OSL_SEAL_KEY:?...}`), the harness makes one per run. Unlike the session secret, development has no
   fallback: a value sealed under a makeshift key is lost with it.
8. **No key, no server.** With a sealed field in the model the app does not start without the key, with a key of
   another length or with one that is not hexadecimal: gin-pgx in the generated `app.Start`, which the server's
   and the worker's `main` call; hono-trpc-vite as `generated/server/app.ts` loads; drizzle-next in
   `instrumentation.ts`, and in the generated `startWorker` for a project whose `instrumentation.ts` was created
   before it had a sealed field (the file is the user's and is not rewritten). Seen on all three: each exits with
   the sentence.
9. **A value that does not open is an error, for a caller the rule allows, and only for them.** Wrong key,
   foreign bytes, a value moved from another column: the answer is 500 `internal`, the log names the column and
   never the value (`[seal] integrations.token: a sealed value did not open: ...`), and the key is never left
   out and never null. A caller the rule refuses never opens the value, so their answer is what it was. The
   app does not find a wrong key at start (nothing sealed is read then); the first read by an allowed caller
   does, and signing in is such a read when the identity has a sealed field its owner reads. Webhooks and audit
   (milestone C): a sealed field is in no payload and no diff, whoever they go to, because the server never
   carries one.
10. **Writes.** A string is sealed and stored, the empty string included (it is a value; `validate.min_length`
    refuses it where the model says). `null` clears an optional sealed field and is refused on a required one. An
    update that leaves the field out leaves the stored bytes as they are. Every write takes a fresh nonce, so
    writing the same value again changes the bytes. The writer is answered the row as it is presented to them:
    the key with exactly what they wrote when the read rule allows them, no key otherwise.
11. **Not everything can be sealed.** `string` and `text` only; no `default`, `unique`, `primary` or relation;
    not an action's field (M090); not taken by `auth.register`, and never written straight into the database by
    the harness or `osl seed` for an example actor.
12. **Pages.** A password input that always starts empty and is offered to whoever may write the field, whatever
    its read rule says; on an edit an empty input sends nothing, so the stored value stays (clearing one is the
    API's `null`). The detail pane has the row only where the answer carries the key.

Typed JSON:

13. **What a key may be.** `string`, `text`, `integer`, `float`, `boolean`, `date`, `datetime`, `uuid`, `enum`,
    an array of string, text, integer, float, boolean or uuid, and one nested `json` with its own `shape`. Every
    other option of a field parses on a key so that its refusal can say why (M186). Money is refused although
    its validators could be reused (B6's first half asked): `numeric(19, 4)` is what keeps an amount exact in
    the database, and in a JSON value it would be a string nothing types. A sequence, a file, a relation and
    `sealed` are fields of their own. `read:` on a key is declined in words: a rule per key is not offered.
    `bigint` and `decimal` are refused because a JSON number is a float. **An array of shapes is refused, which
    departs from the design**: neither web backend has a repeater to render one, and a list of objects is what an
    entity with a relation and a position already is.
14. **A key is there with a value, or it is not there.** `null` at a key is refused, a key the shape does not
    name is refused, and an update replaces the whole value: keys are not merged with what is stored.
15. **A default is applied on write.** A key with a `default` that the writer leaves out is stored with it. The
    field's own `default` is the JSON a row starts with and is held to the shape when the model is validated.
16. **Rows that exist are not touched and not checked.** A shape that is added or changed is no migration step,
    and a read answers what is stored: a value written before the change is returned as it is until it is
    written again, and then the whole value must fit. Refusing the read would make the row unreachable, the one
    thing needed to repair it; dropping what does not fit would hide data. The types describe values written
    under the shape, and the reference says to add keys as optional or with a default. For the same reason **the
    Go row keeps `json.RawMessage`**, where the design said a Go struct: decoding into a struct on every read
    drops unknown keys and fails on a wrong type, so the three backends would answer differently for the same
    stored value. A struct per shape is generated beside it for a handler to decode into. The fuzz walk holds
    the three backends to this: it stores a value that misses its shape and reads it back through the API.
17. **One reference, two validators.** `shapeValueProblem` in core says what does not fit and at which key; the
    generated Zod objects and Go's `validation.Shape` are held to it by the fuzz walk, which sends only what the
    reference refuses. An unknown key is refused under its own path on every backend (`config.extra`): the Zod
    objects use a catch-all that refuses, since `.strict()` reports the object's path. Under REST the 400 lists
    `{ path, message }` in `error.details`; under tRPC the message is Zod's list of issues, or the handler's
    `<path>: <what is wrong>`.
18. **A shape is not an action's field** (M090): an action's fields are already the keys of its input.
    `auth.register` takes a field with a `shape` and not one with `shape_by`.

A shape per enum value:

19. **`shape_by: { <enum field>: { <value>: <shape> } }`**, the backlog's sketch. The enum is a required field of
    the same entity that every reader of the row reads (not hidden, no `read:`, since the keys of the value tell
    which shape it has), every value names a shape (`{}` for a value with nothing to hold) and no other value is
    named (M187).
20. **The pair is held on every write, by the handler, on the row it loaded.** A create checks the value against
    the shape of the enum value in the body (or the enum's default). An update checks it against the enum value
    the row will have: the body's, else the stored one. An update that changes the enum without sending the value
    answers 400 naming the value, unless the row has none. M188 warns where an update can write the enum and not
    the value. (As recommended, after the currency guard of the first half.) A handler of the user's that writes
    either field keeps the pair itself, as it keeps a `read_only` field.
21. **Not on the field of `transitions`** (M187): a transition writes the state and nothing else, so it would
    leave a value that no longer fits. (As recommended.) A later round needs a transition that carries an input,
    or a `set:` on a step, before the two can meet.
22. **Pages.** The group of inputs follows the enum's select: one group per value, the one of the chosen value
    shown, each keeping what was typed into it. When the enum is not a value of the same form the field stays a
    JSON box.

Both:

23. **Diagnostics M185 to M188**; M189 is free. Where an existing check already refuses, its code stands (M033,
    M090, M154, M170, M180). (M189 was taken by the hardening pass of 2026-11-10, for an identity nobody could
    sign up to.)
24. **The harness.** The field watch compares a sealed value an allowed caller is answered with what its column
    holds once opened by the reference. The leak walk's sealed part and the fuzz walk's shape probes are in the
    proof above; negative controls (the rule ignored, the server reading, the value stored in the clear, another
    binding, a silent absence, a shape not held, a path not named) each fail the check they aim at. One harness
    bug was found by the fixture and fixed: the "longer than" probe used 255 for a string whose `max_length` is
    larger.
25. **One intent, FEAT-16**, with a new entity, where the design had two fields on `User`: an integration has a
    kind, settings that follow it and secrets, so the three constructs meet in one place, and the identity still
    gets a shaped and a sealed field of its own. `hidden` with `sealed` is covered by a unit test of the model
    and the IR, not by the fixture.

## Size

Core: two types, nine keys, the counter table in migrations, nine diagnostic codes, two small modules (the seal
format, the shapes), the reference. Validation, presentation and form work in the shared TypeScript generators and
the Go packages. Together about the size of the pages round; each piece can ship alone, sequences first.
