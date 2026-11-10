# The road to 1.0.0

**Status: agreed 2026-11-09, revised 2026-11-10.** The plan for the version that leaves alpha, built from three
sources: the generated rounds and corpus runs of the gap-mining loop, the survey of two hand-written applications
of OSL's shape (the nine design notes under `designs/`), and the three clone exercises under `exercises/`. It names
the rounds, their order and why, what each must prove, and what 1.0.0 leaves out. Every round still begins with a
design a person reviews, as the loop's rules require. What is built is under Progress. The revision came from a
review of the plan against the code, the fixtures and the backlog: it moved two rounds, added one, added the
quality rounds and moved the first publication. Each change is listed under the decisions of 2026-11-10, with its
evidence beside the round it concerns.

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
  fresh rounds stop reporting the clusters, and the kits at the end are proven prefixes. The loop measures what a
  model can say. What a project built on an earlier alpha can still do is measured by the quality rounds, which no
  round of intents reports.

## The rounds

One construct per round (two when they share a proof), each with a design note, a fixture intent with scenarios
on all three backends, eval cases, a regrade of earlier rounds with `--resume`, and the backlog flip. Sizes are
in the notes' own units, relative to the rounds already built (the hidden-rows round is the smallest, the pages
and scheduling rounds the largest). Rounds that add no grammar are the quality rounds, in their own table after
milestone D.

### Milestone A: access (`1.0.0-alpha.4`)

| #   | Round                                                                                                                                                                                                                    | Design                                                 | Evidence                                                                                             | Size                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A1  | Conformance walks: the rule, cross-tenant, leak, fuzz and contract-diff walks over every fixture                                                                                                                         | `designs/conformance-walks.md`                         | the survey; raises every later proof                                                                 | smaller than any construct                      |
| A2  | Membership through any relation: `member:` ending in a membership relation, `ranked: true`                                                                                                                               | `designs/membership-through-any-relation.md`, approved | three exercises (Slack in four intents)                                                              | the relations round                             |
| A3  | Pages with parameters and sections, with a tenant context: a page over one row at its own address, sections from other resources filtered by the parameter, `{tenant.id}` and a switcher                                 | to write                                               | three exercises, 2 cases, the top open page gap                                                      | the pages round                                 |
| A4  | Invites: email invites with a role, acceptance that creates the account, auto-accept on every sign-in path                                                                                                               | `designs/invites.md`                                   | 3 cases, the top of the backlog; the SaaS kit needs it                                               | the hidden-rows round plus web work             |
| A5  | Role ceiling on membership writes: a write of a ranked role (the tenancy `role_field`, or an enum marked `ranked: true` on a membership entity) may not grant a role above the writer's own, the check A4's invites make | to write                                               | 2 cases (the role changes gap), Slack; the workspace fixture, where an admin may write `role: owner` | near the hidden-rows round, to size in the note |
| A6  | Rules and time: `when actor.<field> = <value>`, `when created_at > now-15m` on predicates and as range filters, timers before a date and on date fields                                                                  | to write                                               | two exercises, three one-off cases                                                                   | smaller than the relations round                |

Why this order: the walks first, so A2 onward are proven against the leak and cross-tenant walks without
writing those scenarios; membership before pages, because the channel page is the proof of both; invites after
membership, because an invite to a channel is the same construct a second time and the design can say so; the
role ceiling straight after invites, because it is the invite's own check applied to the membership resource and
the two ways to a role should not disagree inside one release; the small rules round last, when the rounds before
it have settled what a predicate can reference and the rule parser (Q2) is in.

A5 was the role changes row of the 1.1 table until 2026-11-10. In the workspace fixture `TeamMember` has `create`
and `update: "member:team_id:admin"`, the generated update checks that rule and writes the patch, and no scenario
has an admin write `role: owner`. By the rules as written an admin can make anyone an owner, themselves included
(read from WS-1 and the `members` update in the hono-trpc-vite snapshot on 2026-11-10, not run), and the only
place to refuse it today is the hand-written `beforeUpdate` hook. The invites design refuses the same grant on its
own path ("the role granted may not outrank the inviter's own role in that team"), and the SaaS kit in D1 ships
roles. The round is the narrow case: a ceiling over a ranked enum needs no grammar for before-and-after values,
which is why the general write rule stays in the 1.1 table. For the note to settle: whether the ceiling also
covers changing or removing the membership of someone who outranks the writer, what happens to the last holder of
the creator role, and whether a model may turn the ceiling off.

### Milestone B: data (`1.0.0-alpha.5`)

| #   | Round                                                                                                                                                                                   | Design                                 | Evidence                                        | Size                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------- | --------------------------------------- |
| B1  | Tenant isolation backstop: policies derived from relations, composite keys, two database roles, the second pass of the cross-tenant walk                                                | `designs/tenant-isolation-backstop.md` | the survey                                      | the scheduling round, mostly migrations |
| B2  | Many-to-many relations and ordered collections, on one new fixture (`music`): an entity-level relation through a junction, `position` within a parent, a `move` action, drag to reorder | `designs/many-to-many-and-ordering.md` | two exercises each, 1 case each                 | the pages round, shared proof           |
| B3  | Archive and counts: `archive: true`, `count_of` kept by triggers                                                                                                                        | `designs/archive-and-counts.md`        | 2 cases, three exercises on counts              | smaller than scheduling                 |
| B4  | State machines: `transitions` on a read-only enum, the guard as a conditional update, boards that drag only allowed moves                                                               | `designs/state-machines.md`            | the review-workflow cases of the corpus         | smaller than scheduling                 |
| B5  | Field-level visibility: `read:` on a field, absent when it refuses, `expect.absent` in scenarios                                                                                        | `designs/field-visibility.md`          | the survey                                      | the hidden-rows round                   |
| B6  | Field kinds: sequences, money, sealed fields, typed JSON with a shape per enum value (the conditional-validation gap)                                                                   | `designs/field-kinds.md`, extended     | 1 case (sequences), Notion's blocks, the survey | the pages round, pieces ship alone      |

Why this order: isolation first, by the reasoning that put the walks first: what is built after it is designed
under the policy instead of being fitted to it afterwards. Counts kept by triggers (B3), full-text search (C2) and
audit entries written in the mutation's transaction (C3) all run under the policy once it is on, and the isolation
note already found one piece that does not fit it (substring search cannot use an index under the policy). It
does not have to wait for the rule shapes of later rounds: the note's policy is one shape for every tenant table,
a membership of the row's tenant, and `isolation: database` is opt-in, so its diagnostics refuse no model that
did not ask for it. From B1 on, a round's design note says what its tables and triggers are under
`isolation: database`. Then B2 is the largest new design and the music fixture the exercises asked for; counts
need reverse relations, which B2 settles; transitions and archive before audit, which records them; visibility
before audit and webhooks, which exclude what it hides; field kinds last because each piece can ship alone and
sequences is the only one a round has asked for.

Isolation was C5, the last construct round, until 2026-11-10. Moving it first found three things its note had
not settled, all from the workspace fixture, where its proof turns isolation on and expects every scenario
unchanged. WS-7 gives Task
`read: "public when project_id.public = true or owner:assignee_id or member:project_id.team_id:admin"`, and the
note refused a session-free alternative on a tenant table. The same rule's `owner:assignee_id` lets a caller in by
a field of the row and not by their teams. And a handler that reads through the policy can no longer tell another
tenant's row from a missing one, so a 403 would have become a 404. The round settled them without a design review
stop, so they are the owner's to review in the note: a public alternative of the read rule is compiled into a
second, SELECT-only policy; every alternative that needs a session also needs a membership of the row's tenant,
which the compiler adds to the rules in the IR and names in a warning; and an existence probe keeps the rule's 401
or 403 for another tenant's row.

### Milestone C: surfaces (`1.0.0-alpha.6`)

| #   | Round                                                                                                      | Design                          | Evidence                                              | Size                             |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------- | -------------------------------- |
| C1  | File access per field: `file: { read: <rule> }` defaulting to the row's read rule, Range on the local path | to write                        | 1 case, two exercises                                 | smaller than the relations round |
| C2  | Lists at scale: `paging: cursor` anchored on the order columns, `search: { mode: full_text }` with ranking | to write                        | Slack and Notion; the survey's message tables         | the relations round              |
| C3  | Audit and webhooks: one entry per mutation in the transaction, signed deliveries with retries              | `designs/audit-and-webhooks.md` | the survey; Slack and Notion partials                 | the scheduling round             |
| C4  | API keys and the MCP surface: scoped keys, idempotency, one tool per operation                             | `designs/agent-surface.md`      | the survey; the loop's own agents are the first users | the pages round, keys first      |

Why this order: files and lists are small and unblock the exercises' remaining partials; audit after transitions
and archive exist to be recorded; the agent surface after the operations it exposes are all there. Isolation
opens milestone B instead of closing this one, so full-text search and the audit table are designed under its
policy.

### Milestone D: kits and the release (`1.0.0`)

| #   | Round                                                                                                                                                                                              | What it is                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| D1  | Kits: `osl init --kit saas` (tenancy, invites, roles, audit, API keys) and `--kit publishing` (posts, comments, moderation, scheduled publishing), each a proven model prefix with its own fixture | the loop's planned third step, once gaps thin |
| D2  | The reference and docs: `architecture.md` "What 1.0.0 added", the README table rows, `backends.md` mapping rows, the `CHANGELOG.md` continued from the checkpoint                                  | release work                                  |

`osl verify` running the walks was D3 until 2026-11-10 and is quality round Q3.

### Quality rounds

The backlog holds what an agent could not express, so every entry in it asks for grammar: all 45 are
`not_delivered` as of 2026-11-10. A quality of what is already generated never enters it, because no intent fails
to say it. These rounds are that second kind. A quality round adds no grammar. Its proof is every fixture's
snapshot staying byte-identical, or a new check in CI, and it is placed by what it must come before, not by a
milestone.

| #   | Round                                                                                                                                                                                                                                                                                                                   | Proof                                                                                                                                                                               | Before                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Q1  | Upgrade safety: a lock an earlier compiler wrote still loads, and the migrations a database already ran come out byte-identical. A project frozen at `1.0.0-alpha.3` is committed with its lock, its migrations and its overlay handlers; the lock gains a format version and the step that brings an older one forward | CI generates the frozen project with the current compiler: applied migrations unchanged, the handlers still typecheck, `osl verify` passes. Each published alpha adds a frozen copy | the first publication                                          |
| Q2  | The rule parser: a tokenizer and a syntax tree read a rule, in place of one composed regular expression and splits on " or ", " and " and " when "; a diagnostic names the position in the rule. `model.ts`, `ir.ts` and `web/pages.ts`, each past 1,500 lines, are split by concern in the same pass                   | every fixture's IR hash and snapshot unchanged, the rule tests passing as they are                                                                                                  | A6, and after A4 lands, since both edit `model.ts` and `ir.ts` |
| Q3  | The walks on a user's project: `osl verify` runs them against a project that is not a fixture                                                                                                                                                                                                                           | a project outside `fixtures/` with a planted leak and a planted missing check fails `osl verify`; the fixtures pass                                                                 | the first publication                                          |

Why these, from what was read on 2026-11-10:

- **Q1.** Every `osl generate` renders every migration again from the IR each revision stored in the lock
  (`migrationFiles` in `packages/core/src/migrations.ts`), and the migration runner refuses a file whose checksum
  changed after it ran. A compiler that plans or renders an old revision differently, or reads a field an older
  stored IR lacks, breaks a deployed project when it upgrades. Nothing tests it: the harness builds each fixture
  from its intents with the current compiler, no lock is committed, and the lock's only version marker is
  `osl: "1.0"`. The baseline is clean: none of the 57 migration snapshots under `fixtures/` has changed since the
  rebuild. The frozen project carries overlay handlers because a fixture's own are fixed in the commit that
  changes a generator, which hides what the change costs a project that was not in that commit.
- **Q2.** `RULE_PATTERN` in `packages/core/src/model.ts` is one regular expression composed from five named
  pieces, and `splitWhen`, `ruleAlternativeTexts` and `conjunctionParts` take a rule apart on its separators. A6
  adds comparisons, a time relative to now and fields of the actor. Whatever the pattern accepts by accident
  becomes grammar an alpha shipped; a parser states what is accepted.
- **Q3.** The walks note deferred this until the harness had proven the walks on the fixtures, which round A1
  did. It is the check a project outside this repository gets for the claim the walks make.

Open quality entries, not scheduled. Each competes with the constructs for a round once it has a design:

| Entry              | What is known                                                                                                                                                                                                                                        | What would schedule it                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Sign-in throttling | the generated register, login and magic-link routes limit no attempts: none was found in the three backends' auth generators or their snapshots on 2026-11-10, and limits per API key are declined in `designs/agent-surface.md` as the deployment's | a design that says where the limit lives in the generated runtime; before `1.0.0` |
| A performance walk | declined in `designs/conformance-walks.md` because latency depends on the machine                                                                                                                                                                    | a budget that does not, such as queries per operation                             |

These live here and not in `evals/propose/gaps.yaml` because the backlog's `kind` is a closed list (`BacklogEntry`
in `packages/evals/src/backlog.ts`); a kind for them is a change to the loop's tooling.

## Dependencies, in one picture

```
A1 walks ──► every later proof
A2 membership ──► A3 pages (channel page) ──► C2 cursor (the page loads older rows)
A2 membership ──► A4 invites (an invite to a channel) ──► A5 role ceiling (the invite's check, on memberships)
Q2 rule parser ──► A6 rules and time (comparisons, now, actor fields)
milestone A, Q1 upgrade safety, Q3 walks in osl verify ──► the first publication (alpha.4)
A2 membership ──► B1 isolation (policies know junction rules) ──► B3 counts, C2 search, C3 audit (designed under it)
B2 many-to-many ──► B3 counts (reverse relations)
B3 archive, B4 transitions ──► C3 audit (records them) ──► C4 MCP (tools cover them)
B5 visibility ──► C3 audit and webhooks (their exclusions)
A4 invites, A5 role ceiling, C3 audit, C4 keys ──► D1 saas kit
```

## What 1.0.0 leaves for 1.1, with the evidence that would pull it forward

| Gap                                                                                                                              | Why it waits                                                                          | Pulls it forward                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Rules inherited through a tree, tree queries, an order among the siblings of a tree (declined by round B2), navigation from data | the largest construct an exercise named, with one app behind it; needs A3             | a round asking twice, or a wiki or folder exercise |
| Write rules by caller beyond the role ceiling (what a client may write into a field depends on who they are)                     | a second grammar for before-and-after values; the ceiling on ranked roles is round A5 | two cases the ceiling does not answer              |
| Search across resources                                                                                                          | a custom page composes the per-resource searches                                      | two cases                                          |
| Dashboard panels beyond counts, sums and averages                                                                                | a trigger per numeric type and a null policy                                          | two cases each                                     |
| Shared secrets and access codes, sign-in flow settings, uniqueness beyond `unique`                                               | one case each                                                                         | a second case                                      |
| Cascading archive, incoming webhooks, rate limits, import and export                                                             | declined in their design notes with a sentence                                        | a round that asks twice                            |

Declined and staying declined: realtime and live updates, payments and billing, user-defined schemas (the
boundary the Notion exercise wrote down), handlers left to implement.

## The loop alongside the rounds

- After each round, `pnpm evals:round` with the new topic in the clusterer, and `--resume` over every earlier
  round, as today. The nightly round keeps running against `main`.
- The generator gains two briefs it does not write today: intents whose caller is a program or an assistant
  (for C4) and intents with two membership shapes or a page per row (for A2 and A3), so that the rounds test the
  constructs the exercises found rather than only the ones they asked for.
- One exercise per milestone, before its design notes are finalized: a Shopify admin for B and C (money,
  sequences, transitions, audit, webhooks), GitHub for C4, Airbnb for A6 and B6. Each adds its intents to a fixture
  or starts a sibling, and its gaps enter the backlog as the first three did.
- The Sonnet comparison runs again at each milestone, since the reference text grows with every round and the
  cheaper proposer is the one that shows when it has grown too much.

## Size and pace

Sixteen construct rounds, three quality rounds and two release pieces, with the first publication after milestone
A. The five construct rounds of 2026-11-09 each took one session from design to backlog flip, with the harness as
the judge; at that pace the version is about sixteen sessions of construct work plus the quality rounds, the
exercises and the release, with the design reviews between them as the human checkpoints the loop requires. Each
round's full eval regrade costs about five dollars; a milestone with its exercise and the Sonnet comparison about
twenty.

## Progress

| Round                              | Status                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 conformance walks               | built 2026-11-09: five walks as harness steps, all fixtures on all backends passing them unchanged; the first run's only findings were the harness's own (`designs/conformance-walks.md`)                                                                                                                                                                         |
| A2 membership through any relation | built 2026-11-09: `member:` paths ending in a membership relation with `ranked: true`, workspace WS-9 channels and blog FEAT-12 followers, 9/9 with walks, oracle 27/27 (`designs/membership-through-any-relation.md`)                                                                                                                                            |
| B1 tenant isolation backstop       | built 2026-11-10: `auth.tenancy.isolation: database`, workspace WS-11, 9/9 with walks, the tenant walk again with the rule checks off and the unbound probe, oracle 28/28 (`designs/tenant-isolation-backstop.md`)                                                                                                                                                |
| B2 many-to-many and ordering       | built 2026-11-10: `relations: { <name>: { through } }` and `position: { within }` with the compiler's `move`, the order kept in the database, a fourth fixture `music` (MU-1 to MU-4) and workspace WS-12 under isolation, 12/12 with six walks (the new one bursts concurrent creates, moves and deletes), oracle 32/32 (`designs/many-to-many-and-ordering.md`) |

## Decisions, as made on 2026-11-09

1. **The checkpoint is `1.0.0-alpha.3`.** The unreleased work ships under the package numbering as it is, and the
   "1.1" label the docs used for the five-construct build is retired in favour of the tag it shipped in,
   `1.0.0-alpha.2`. Milestones A, B and C are alpha.4, alpha.5 and alpha.6; D is `1.0.0`.
2. **Isolation is in.** C5 stays the last round of milestone C. (Revised on 2026-11-10: decision 6.)
3. **Kits are in.** D1 closes the version.
4. **The public surface waits.** `@osl/*` is unpublished on npm and the schemas on GHCR still carry the old names;
   the external identifiers (org, registry, domain) stay as they are. Publishing is release work that touches
   accounts outside the repo and needs its own go-ahead at `1.0.0`. (Revised on 2026-11-10: decision 8.)
5. **The legacy tree stays.** `legacy/` (the 0.1 Studio and VS Code extension) is untouched through the alphas.

## Decisions revised and added on 2026-11-10

From a review of this plan against the code, the fixtures and the backlog. The evidence for each is beside the
round it concerns.

6. **Isolation opens milestone B.** It was C5, last, so that the policy compiler would know every rule shape
   first. The note's policy is one shape for every tenant table and the construct is opt-in, while counts,
   full-text search and audit all run under it. Built first, they are designed under it. The questions the move
   raised were settled by the round and are in its note.
7. **The role ceiling is in 1.0.0.** The narrow case of the role changes gap is round A5, and rules and time is
   A6. The general write rule stays in the 1.1 table.
8. **The first publication is `1.0.0-alpha.4`.** Waiting for `1.0.0` meant thirteen more rounds of grammar decided
   before anyone outside could use one. Publishing still touches accounts outside the repo and still needs its
   own go-ahead, asked for when milestone A, Q1 and Q3 are done; the external identifiers are decided then.
9. **The grammar freezes at `1.0.0`.** The design notes call the grammar permanent, and from `1.0.0` it is. Until
   then a construct an alpha shipped may still change, when the change comes with the step that rewrites an older
   model, proven on the frozen project of Q1, and a line in the changelog.
10. **Quality rounds exist.** What the backlog cannot hold has its own table. Q1 and Q3 come before the first
    publication and Q2 before A6. `osl verify` running the walks was D3 and is Q3.
