# Design: pages beyond master-detail

**Status: built 2026-11-09.** What changed from the design below while building: a resource page cannot take `/`
(the split layout's child routes have no flat-route spelling at the root), so the landing page is a dashboard or a
custom page; `access` compiles like a rule into the IR and the shell's nav carries it per page and sidebar item; the
gate wraps each exported page component so hooks keep their order; tile `group_by` over an enum expands at
generation time, over a relation at runtime with one count query per related row. Proof: blog FEAT-8 and todo
TODO-6, conformance 9/9 on all backends, eval cases `fx-blog-8-home-and-access`, `fx-todo-6-home-dashboard`,
`blog5-staff-board` and `ws2-public-roadmap`.

The second-largest open gap in the backlog, from runs 6 and 7 and the three generated rounds. This note turns
the lines agents wrote into constructs with a deterministic mapping, names what is only a missing sentence in
the reference, and declines the rest. It is the design to review before the build; the grammar is permanent.

## What was asked, in the agents' words

| Ask | Where | Verdict |
| --- | --- | --- |
| "The app's landing route `/` is reserved for the shell, so the equipment page cannot be pinned there" | r1-01, r1-08 | construct: a page at `/` |
| "A public status page outside the signed-in workspace: there is no construct for an unauthenticated, shareable page" | r1-07, r2-05 | half reference, half construct: anonymous visitors already see every page whose resource is public; what is missing is a page access rule |
| "Limiting the editorial board page to staff: pages have no access rules, so every signed-in user sees the same board" | r3-05 | construct: page access rule |
| "Showing writers only their own and co-authored articles on the board: pages cannot filter by the signed-in user" | r3-05 | construct: page filters with `{actor.id}` |
| "A home page scoped to a single team: pages cannot be scoped to one team and there is no team switcher" | r1-08 | declined: a tenant switcher is a shell feature with no model shape yet |
| "The waiting-room screen updating by itself when someone checks in: no live push or auto-refresh" | r1-05 | construct: `refresh` (polling); push stays declined |
| "A task count in each board column header: the board layout has no count option" | r1-08, r3-05, r2-04 | reference: boards already show the count in each column header |
| "Per-doctor cards: dashboard tiles use fixed filters, so doctors added at runtime cannot get their own card" | r1-05 | construct: tile `group_by`, one tile per enum value or per row of a related resource |
| "A tile filter cannot express a due date before today"; "showing only upcoming events starting after now" | r2-04, r3-08 | separate construct, list filters with comparisons; named here, designed next |
| "Pages cannot add related lists"; "an article's series with previous/next links" | r3-06, r3-01 | reference: the detail pane already renders every reverse relation the get operation includes; prev/next stays a custom page |
| Charts, calendars, custom layouts | several one-offs | declined for now: custom pages exist for them |

## Constructs

Everything below applies to the two web backends; `gin-pgx` is API-only and ignores `app`, as today.

### 1. A page at `/`

`path: /` is allowed for exactly one page. The shell's index route renders it; without one, the shell keeps its
current welcome card. `/login` and `/settings` stay reserved.

- Validation: M084 drops `/` from the reserved list; M085 (duplicate path) already covers two pages claiming it.
- drizzle-next: `app/page.tsx` renders that page's component instead of the welcome card.
- hono-trpc-vite: `src/routes/index.tsx` does the same.
- Reference: one line under `path`.

### 2. Page access

```yaml
pages:
  board:
    resource: articles
    access: role:editor        # public | authenticated | role:<value>; default: authenticated when auth exists, public otherwise
```

Who may open the page. The sidebar lists only the pages the current user may open; opening a page the user
may not open redirects anonymous visitors to `/login` and shows signed-in users a "not allowed" card. The
API's rules still decide what the page can read: a public page over a resource whose read rule needs a session
would show an empty list, so that is refused.

- Grammar: `access` is a plain predicate, the same spelling as rules without owner or member (those need a row).
- Validation: M091 `access` is not public, authenticated or role:<value>; M092 a public page over a resource whose
  read rule is not public (or a dashboard whose tiles or recent read a non-public resource); M091 also when `access`
  names a role but the identity has no `role` field, and when `access` is not public without auth.
- IR: `PageIR.access: RuleIR` (public, authenticated or role), compiled like rules.
- Both web backends: the generated `SIDEBAR` carries each item's access, the shell filters items with the session,
  and each page component checks `access` first (`<RequireAccess>`), reusing `rulePredicate` from the pages module.
- Reference: the `access` line in the page block, plus the sentence that anonymous visitors already see public
  pages (the half that was a reference gap).

### 3. Page and tile filters, with the signed-in user

```yaml
pages:
  mine:
    resource: articles
    filter: { author_id: "{actor.id}", status: review }     # equality filters from the resource's list filters
  home:
    kind: dashboard
    tiles:
      - { resource: tasks, label: My open tasks, filter: { assignee_id: "{actor.id}", done: false } }
```

A resource page's list always carries `filter`; the user's own filter controls stay available for the other
list filters. `{actor.id}` is the signed-in user's id, so the page or tile needs `access` authenticated or a
role (M092 otherwise: a public page cannot filter by a user who may not exist).

- Validation: M089 already checks tile filters against the resource's list filters; the same check applies to
  the page `filter`; `{actor.id}` is allowed only on a relation field to the identity entity or the identity's key.
- IR: `PageIR.filter: Record<string, Literal | { actor: "id" }>`; tiles the same.
- Both web backends: the list input merges the fixed filter; `{actor.id}` resolves from `sessionUser` and the
  query waits for the session (`enabled: !!user`).
- Reference: the `filter` line in the page block and under tiles.

### 4. Refresh

```yaml
pages:
  waiting_room:
    resource: visits
    refresh: 15                # seconds; the page refetches on this interval while it is open
```

Polling, not push: the queries of that page (list, tiles, recent) get `refetchInterval: 15000`. Allowed values
5 to 3600. Realtime stays declined in the reference, with this as the sentence that says what to do instead.

### 5. Tiles grouped by a value

```yaml
tiles:
  - { resource: tasks, group_by: status }          # one tile per enum value, counts filtered by it
  - { resource: visits, group_by: doctor_id }      # one tile per row of the related resource, labelled by its title
```

- Enum: one count query per value, labels from the enum values in Title Case.
- Relation: the related entity must have a resource with `list`; the tile list queries that resource (page size
  200, the cap) and one count per row, labelled by the related row's title column. Validation M089 when the field
  is neither an enum nor a relation with a listable resource.
- IR: `TileIR.groupBy?: { kind: "enum"; values } | { kind: "relation"; resource; labelColumn }`.

### 6. Reference sentences, no construct

- Boards show the count of cards in each column header (they load up to 200 cards).
- The detail pane renders the rows of every reverse relation the get operation includes; a page that needs more
  than that is a custom page.
- Anonymous visitors see every page whose resource is publicly readable; `access` narrows that, it does not
  widen the API.

## Declined, with the sentence the reference gets

- Live push and websockets: use `refresh`.
- A tenant switcher and pages scoped to one team: lists already show only the user's tenants; a switcher is a
  shell feature without a model shape, so it stays out until a kit needs it.
- Charts, calendars, threaded layouts: custom pages, scaffolded once; `osl implement` does not write pages.
- Comparisons in filters (`due before today`, `starting after now`): a list construct, not a page one; designed
  next as `filters: [status, { field: due_on, ops: [before, after] }]`.

## Proof

- Fixtures: todo gains TODO-6 (`home` at `/` as a dashboard with a `group_by: status` tile and `refresh: 30`; a
  `mine` page filtered by `{actor.id}` with `access: authenticated`); workspace gains WS-5 (a public `status`
  page over projects with `access: public`, a `board` page with `access: role:admin`). Scenarios prove the API side
  the pages rely on (public reads, 401 for the filtered list without a session); the generated pages are proven by
  typecheck and the snapshots, as pages are today.
- Eval cases: `fx-todo-6-home-and-mine`, `fx-ws-5-public-status` with the fixtures' diffs as oracles, plus
  `blog5-staff-board` (a role-gated board over the blog) and the generated-round ask `gen-r2-05-public-project-roadmap`
  promoted into the corpus as `ws2-public-roadmap`.
- Gate: conformance 9/9, snapshots updated, `pnpm evals --proposer oracle --no-full` green, round r1 to r3 graded
  again with `--resume` losing nothing, and a fresh round no longer reporting "pages beyond master-detail".

## Size

Core: `Page` and `DashboardTile` schema, five diagnostics, `PageIR` and `TileIR` additions, reference. Web
(`packages/ts-common/src/web`): shell index route and sidebar filtering, `RequireAccess`, fixed filters with
`{actor.id}`, `refetchInterval`, grouped tiles. Two fixtures, four eval cases, snapshots. About the size of the
rules round.
