# The road to 1.0.0

**Status: agreed 2026-11-09.** The plan for the version that leaves alpha, built from three sources: the generated
rounds and corpus runs of the gap-mining loop, the survey of two hand-written applications of OSL's shape (the
nine design notes under `designs/`), and the three clone exercises under `exercises/`. It names the rounds, their
order and why, what each must prove, and what 1.0.0 leaves out. Nothing here is built; every round still begins
with a design a person reviews, as the loop's rules require.

OSL is in first-version territory: the packages say `1.0.0-alpha.2`, and the five-construct build the README
used to call "1.1" shipped inside that tag. The numbering from here is alpha releases of 1.0.0, one per
milestone, and `1.0.0` itself at the end.

## Where the road starts

Seven pieces have landed since `v1.0.0-alpha.2` and are unreleased: read-only fields with `osl implement`, the
gap-mining loop (rounds, the backlog, the nightly run), row conditions on rules, pages beyond master-detail,
schedules and timers, conditions through relations with conjunctions, and hidden rows as not found. They ship
first as `1.0.0-alpha.3`, the checkpoint, so that every later round regrades against a tagged baseline.

What alpha.2 proved is that OSL generates a working application of one shape: one tenant, master-detail pages,
CRUD with actions, auth with providers, files, jobs. What the research says, in one line each:

- **The rounds** ask for the next construct one at a time, and the five built on 2026-11-09 each emptied its
  cluster within a round. What remains in the backlog by cases: invites (3), pages with parameters (2), computed
  fields (2), role changes (2), then one-offs.
- **The survey** found what hand-written applications build for themselves and police with lint: tenant
  isolation in the database, field-level visibility, state machines, money and sequences, archive and counts,
  audit and webhooks, API keys and an MCP surface, and five structural walks. No round asks for them, because a
  ten-line intent describes users, not operators or partners.
- **The exercises** found what composes: every app with a second membership shape stops at `member:`, every
  screen but the top three is a parameterized page, playlists and blocks are ordered, and two apps (Slack, Notion)
  are chat logs and editors that stay custom. Two gaps appear in all three apps, pages with parameters and
  membership through any relation, and neither came from a round.

  1.0.0 is the version where OSL generates the applications people actually ship: a second membership shape, pages
  at their own addresses, ordered and many-to-many data, the server-owned patterns the survey found, and an agent
  surface. It is measured the way the loop measures everything: the exercises' partial and out intents become yes,
  fresh rounds stop reporting the clusters, and the kits at the end are proven prefixes.

## The rounds

One construct per round (two when they share a proof), each with a design note, a fixture intent with scenarios
on all three backends, eval cases, a regrade of earlier rounds with `--resume`, and the backlog flip. Sizes are
in the notes' own units, relative to the rounds already built (the hidden-rows round is the smallest, the pages
and scheduling rounds the largest).

### Milestone A: access (`1.0.0-alpha.4`)

| #   | Round                                                                                                                                                                                    | Design                                                 | Evidence                                               | Size                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------- |
| A1  | Conformance walks: the rule, cross-tenant, leak, fuzz and contract-diff walks over every fixture                                                                                         | `designs/conformance-walks.md`                         | the survey; raises every later proof                   | smaller than any construct          |
| A2  | Membership through any relation: `member:` ending in a membership relation, `ranked: true`                                                                                               | `designs/membership-through-any-relation.md`, approved | three exercises (Slack in four intents)                | the relations round                 |
| A3  | Pages with parameters and sections, with a tenant context: a page over one row at its own address, sections from other resources filtered by the parameter, `{tenant.id}` and a switcher | to write                                               | three exercises, 2 cases, the top open page gap        | the pages round                     |
| A4  | Invites: email invites with a role, acceptance that creates the account, auto-accept on every sign-in path                                                                               | `designs/invites.md`                                   | 3 cases, the top of the backlog; the SaaS kit needs it | the hidden-rows round plus web work |
| A5  | Rules and time: `when actor.<field> = <value>`, `when created_at > now-15m` on predicates and as range filters, timers before a date and on date fields                                  | to write                                               | two exercises, three one-off cases                     | smaller than the relations round    |

Why this order: the walks first, so A2 onward are proven against the leak and cross-tenant walks without
writing those scenarios; membership before pages, because the channel page is the proof of both; invites after
membership, because an invite to a channel is the same construct a second time and the design can say so; the
small rules round last, when the three before it have settled what a predicate can reference.

### Milestone B: data (`1.0.0-alpha.5`)

| #   | Round                                                                                                                                                                                   | Design                             | Evidence                                        | Size                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------- | ---------------------------------- |
| B1  | Many-to-many relations and ordered collections, on one new fixture (`music`): an entity-level relation through a junction, `position` within a parent, a `move` action, drag to reorder | to write                           | two exercises each, 1 case each                 | the pages round, shared proof      |
| B2  | Archive and counts: `archive: true`, `count_of` kept by triggers                                                                                                                        | `designs/archive-and-counts.md`    | 2 cases, three exercises on counts              | smaller than scheduling            |
| B3  | State machines: `transitions` on a read-only enum, the guard as a conditional update, boards that drag only allowed moves                                                               | `designs/state-machines.md`        | the review-workflow cases of the corpus         | smaller than scheduling            |
| B4  | Field-level visibility: `read:` on a field, absent when it refuses, `expect.absent` in scenarios                                                                                        | `designs/field-visibility.md`      | the survey                                      | the hidden-rows round              |
| B5  | Field kinds: sequences, money, sealed fields, typed JSON with a shape per enum value (the conditional-validation gap)                                                                   | `designs/field-kinds.md`, extended | 1 case (sequences), Notion's blocks, the survey | the pages round, pieces ship alone |

Why this order: B1 is the largest new design and the music fixture the exercises asked for; counts need reverse
relations, which B1 settles; transitions and archive before audit, which records them; visibility before audit and
webhooks, which exclude what it hides; field kinds last because each piece can ship alone and sequences is the
only one a round has asked for.

### Milestone C: surfaces (`1.0.0-alpha.6`)

| #   | Round                                                                                                                                    | Design                                 | Evidence                                              | Size                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| C1  | File access per field: `file: { read: <rule> }` defaulting to the row's read rule, Range on the local path                               | to write                               | 1 case, two exercises                                 | smaller than the relations round        |
| C2  | Lists at scale: `paging: cursor` anchored on the order columns, `search: { mode: full_text }` with ranking                               | to write                               | Slack and Notion; the survey's message tables         | the relations round                     |
| C3  | Audit and webhooks: one entry per mutation in the transaction, signed deliveries with retries                                            | `designs/audit-and-webhooks.md`        | the survey; Slack and Notion partials                 | the scheduling round                    |
| C4  | API keys and the MCP surface: scoped keys, idempotency, one tool per operation                                                           | `designs/agent-surface.md`             | the survey; the loop's own agents are the first users | the pages round, keys first             |
| C5  | Tenant isolation backstop: policies derived from relations, composite keys, two database roles, the second pass of the cross-tenant walk | `designs/tenant-isolation-backstop.md` | the survey                                            | the scheduling round, mostly migrations |

Why this order: files and lists are small and unblock the exercises' remaining partials; audit after transitions
and archive exist to be recorded; the agent surface after the operations it exposes are all there; isolation
last, because the policy compiler must know every rule shape the alphas added, and because it refuses public
alternatives on tenant tables, which is a diagnostic worth adding only once the rest is stable.

### Milestone D: kits and the release (`1.0.0`)

| #   | Round                                                                                                                                                                                              | What it is                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| D1  | Kits: `osl init --kit saas` (tenancy, invites, roles, audit, API keys) and `--kit publishing` (posts, comments, moderation, scheduled publishing), each a proven model prefix with its own fixture | the loop's planned third step, once gaps thin |
| D2  | The reference and docs: `architecture.md` "What 1.0.0 added", the README table rows, `backends.md` mapping rows, the `CHANGELOG.md` continued from the checkpoint                                  | release work                                  |
| D3  | An `osl verify` that runs the walks against a user's project                                                                                                                                       | the walks note's deferred item                |

## Dependencies, in one picture

```
A1 walks ──► every later proof
A2 membership ──► A3 pages (channel page) ──► C2 cursor (the page loads older rows)
A2 membership ──► A4 invites (an invite to a channel)
A2 membership ──► C5 isolation (policies know junction rules)
B1 many-to-many ──► B2 counts (reverse relations)
B2 archive, B3 transitions ──► C3 audit (records them) ──► C4 MCP (tools cover them)
B4 visibility ──► C3 audit and webhooks (their exclusions)
A4 invites, C3 audit, C4 keys ──► D1 saas kit
```

## What 1.0.0 leaves for 1.1, with the evidence that would pull it forward

| Gap                                                                                | Why it waits                                                              | Pulls it forward                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Rules inherited through a tree, tree queries, navigation from data                 | the largest construct an exercise named, with one app behind it; needs A3 | a round asking twice, or a wiki or folder exercise |
| Role changes (what a client may write depends on who they are)                     | a second grammar for before-and-after values                              | two more cases                                     |
| Search across resources                                                            | a custom page composes the per-resource searches                          | two cases                                          |
| Dashboard panels beyond counts, sums and averages                                  | a trigger per numeric type and a null policy                              | two cases each                                     |
| Shared secrets and access codes, sign-in flow settings, uniqueness beyond `unique` | one case each                                                             | a second case                                      |
| Cascading archive, incoming webhooks, rate limits, import and export               | declined in their design notes with a sentence                            | a round that asks twice                            |

Declined and staying declined: realtime and live updates, payments and billing, user-defined schemas (the
boundary the Notion exercise wrote down), handlers left to implement.

## The loop alongside the rounds

- After each round, `pnpm evals:round` with the new topic in the clusterer, and `--resume` over every earlier
  round, as today. The nightly round keeps running against `main`.
- The generator gains two briefs it does not write today: intents whose caller is a program or an assistant
  (for C4) and intents with two membership shapes or a page per row (for A2 and A3), so that the rounds test the
  constructs the exercises found rather than only the ones they asked for.
- One exercise per milestone, before its design notes are finalized: a Shopify admin for B and C (money,
  sequences, transitions, audit, webhooks), GitHub for C4, Airbnb for A5 and B5. Each adds its intents to a fixture
  or starts a sibling, and its gaps enter the backlog as the first three did.
- The Sonnet comparison runs again at each milestone, since the reference text grows with every round and the
  cheaper proposer is the one that shows when it has grown too much.

## Size and pace

Fifteen rounds and three release pieces. The five construct rounds of 2026-11-09 each took one session from
design to backlog flip, with the harness as the judge; at that pace the version is about fifteen sessions of
construct work plus the exercises and the release, with the design reviews between them as the human checkpoints
the loop requires. Each round's full eval regrade costs about five dollars; a milestone with its exercise and the
Sonnet comparison about twenty.

## Progress

| Round                              | Status                                                                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 conformance walks               | built 2026-11-09: five walks as harness steps, all fixtures on all backends passing them unchanged; the first run's only findings were the harness's own (`designs/conformance-walks.md`)                              |
| A2 membership through any relation | built 2026-11-09: `member:` paths ending in a membership relation with `ranked: true`, workspace WS-9 channels and blog FEAT-12 followers, 9/9 with walks, oracle 27/27 (`designs/membership-through-any-relation.md`) |

## Decisions, as made on 2026-11-09

1. **The checkpoint is `1.0.0-alpha.3`.** The unreleased work ships under the package numbering as it is, and the
   "1.1" label the docs used for the five-construct build is retired in favour of the tag it shipped in,
   `1.0.0-alpha.2`. Milestones A, B and C are alpha.4, alpha.5 and alpha.6; D is `1.0.0`.
2. **Isolation is in.** C5 stays the last round of milestone C.
3. **Kits are in.** D1 closes the version.
4. **The public surface waits.** `@osl/*` is unpublished on npm and the schemas on GHCR still carry the old names;
   the external identifiers (org, registry, domain) stay as they are. Publishing is release work that touches
   accounts outside the repo and needs its own go-ahead at `1.0.0`.
5. **The legacy tree stays.** `legacy/` (the 0.1 Studio and VS Code extension) is untouched through the alphas.
