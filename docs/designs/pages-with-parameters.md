# Design: pages with parameters

**Status: built 2026-11-09** (round A3 of the road to 1.0.0, `docs/roadmap.md`). The design was approved as written
the same day, with the tenant context in the same round; the choices at the end are settled. What changed from the
design below while building: the grammar is as written. A section's `limit` and `create` are optional with defaults
in the IR (10 and false), and its `order` is one pair. M084 also refuses a detail page whose base path is reserved,
and M089 refuses `{actor.x}`, `{row.x}` and `{tenant.x}` other than `.id`. `remove_resource` refuses a resource a
section still lists, and `remove_field` and `rename_field` rewrite section and recent filters. In the generated
app, both clients export `errorStatus` and the UI kit gains `RowError`, so a detail page tells a missing row from a
refused one; a table page drops the filter control of a field its fixed `filter` sets; a standalone detail page
returns to `/` after a delete and has no back link; forms beside the main one prefix their input ids; a relation's
value links to the first page over the related entity, which moved the todo snapshots too; a section is left out
when its list answers 401 or 403 or when no tenant is chosen, and a dashboard filtered by the tenant shows the
no-tenant state. The tenant module is `generated/app/tenant.tsx`: `useTenant()` returns `{ tenant, tenants,
setTenant, loading }`, the switcher is a native select in the sidebar header, hidden while the sidebar is
collapsed, and the choice is kept under `osl.tenant`. The flat route under a dashboard or custom page holds on
TanStack, checked on `hono-trpc-vite`, the one backend with that router. In the harness, the tenant walk excepts
rows the read rule opens to everyone (a public project read by an outsider is not a leak), and the evals' page
expectations learned `kind: detail`, `sections` and `tenant`. Known limits: when the tenant list fails to load,
pages show the no-tenant state; a relation value whose get does not include the relation shows the id; a page
nested deeper under another page's path renders inside that page's route on TanStack.

Proof: workspace WS-10 "channel page and team home" (a channel page with messages and members sections,
`{tenant.id}` on the projects, channels and members pages and on a home dashboard, actor dana, 33 steps) and blog
FEAT-13 "author and article pages" (a public author page with published articles, an article page whose comments
section creates, a public share link per announcement, actor erin, 14 steps); conformance 9/9 with the five walks
(blog 155 scenario tests per TypeScript backend, 738 rule calls and 912 probes; workspace 198, 777 and 1205, with
16 home-team rows checked against an outsider; todo 39); 122 unit tests; the oracle gate 29/29 with
`fx-ws-10-channel-page-and-team-home` and `fx-blog-13-author-and-article-pages`; and three cases for live rounds,
`empty-org-public-roadmap`, `ws2-team-dashboard-files` and `ws2-public-project-pages`, the last graded on the model
only, because `hidden: not_found` on Project turns steps of two earlier scenarios false and no op replaces a
scenario in place (recorded in the backlog as scenarios replaced in place). Rounds r1 to r7 graded again with
`--resume` on this build and on the commit before it: 59 of 65 recorded proposals keep their recorded grade on
both, five no longer apply on either, because generated cases pin no `through` and the fixtures have grown since,
and one that errored when recorded was proposed again and is valid. Nothing is lost to A3.

Round r8 (seed 73, ten intents, `--no-full`, $2.09 with generation) drew three page-per-row briefs from the two
constraints the generator gained with this round. All ten diffs were valid, each of the three answered with `kind:
detail` pages and sections filtered by `{row.id}` (a forum with four of them, a route page whose stops section
creates, a project overview), and "pages with parameters" was not reported. The round's first clustering flagged
two built topics, pages beyond master-detail and scheduled and recurring work; every line under them was read, and
none asks for what was built. They are what the Declined section leaves out or another gap in page words, and are
topics of the clusterer now: sections beyond lists (counts beside the lists, an image shown inline, a section under
each row), list filters through a relation (tasks of the projects I follow), field-level visibility (a public
profile over `users` would return every email), conditions against now (overdue, today's rows) and schedules per
tenant. The round's own files (`round.yaml`, `compare-gaps.md`) keep the first clustering; its `gaps.md` and the
backlog hold the second.

The top open page gap of the backlog (`pages with parameters`, open since r5) and the one gap all three clone
exercises hit: every Spotify screen but Home, Search and Library is a page over one row, Slack's channel screen is
one inside a chosen workspace, and Notion's page address is one. Pages today are a list with a detail pane, a
dashboard or a hand-written file, and no path takes a parameter. This note adds a page over one row at its own
address, the lists that page shows from other resources, and a current tenant that pages filter by. No backend's
API changes: every list a page shows is one a resource already serves, and the rules still decide what comes back.
It is the design to review before the build; the grammar is permanent.

## What was asked, in the agents' and the exercises' words

| Ask                                                                                                                                                                                                    | Where               | Verdict                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "A separate public URL for each organisation's roadmap is not possible because pages cannot take the organisation from the URL."                                                                       | r5-02               | construct: a public detail page over the organisation, with a section of its items                                                                                                 |
| A project marked public gets "a page anyone can read without signing in, showing the project's name, status and its task titles with whether they're done", and a 404 for a project that is not public | r5-10               | construct: a detail page with a section, as a share link over a hidden row                                                                                                         |
| "The public request form is only a scaffolded custom page at /request. Its form and the way it picks the project from the link must be written by hand."                                               | r5-01               | declined for now: the address and the preset are the detail page's, but a form whose list the visitor may not read is not a section; it stays a custom page                        |
| "One dashboard per team: a page cannot be scoped to a single team, so the dashboard counts across every team the user belongs to."                                                                     | r6-03               | construct: `{tenant.id}` in filters and a switcher                                                                                                                                 |
| "Front-page totals are not scoped to one school. A user who belongs to several schools sees combined counts, because pages cannot be scoped to a single tenant."                                       | r6-06               | construct: the same, for every resource with a list filter on its tenant relation                                                                                                  |
| "A home page scoped to a single team: pages cannot be scoped to one team and there is no team switcher"                                                                                                | r1-08               | construct: this reverses the decline in `pages-beyond-master-detail.md`; the model shape it lacked is `{tenant.id}`                                                                |
| "Each artist, album, playlist and listener has a page at its own address, composed of a header and lists from other resources, shareable as a link when public."                                       | Spotify SP-11       | construct: detail pages with sections; public ones are share links                                                                                                                 |
| "a channel page sits at its own address with the newest messages at the bottom, older ones loading on scroll, and a composer; people switch workspaces"                                                | Slack SL-12         | construct for the address, the sections, the composer as a section's form and the switcher; the chat layout stays a custom page and loading on scroll waits for cursor paging (C2) |
| "a click opens the page at its own address"; "A published page is readable by anyone at a public address"                                                                                              | Notion NO-12, NO-15 | construct for the address and the public page; the sidebar tree is navigation from data (1.1) and the reader is a custom page                                                      |

## Constructs

Everything below applies to the two web backends; `gin-pgx` is API-only and ignores `app`, as today. The diff ops
stay as they are: `add_page` and `update_page` carry the new keys.

### 1. A detail page: one row at its own address

```yaml
pages:
  channels: { resource: channels, layout: table, columns: [name, private, team_id] } # as today, at /channels
  channel:
    kind: detail # resource | dashboard | custom | detail
    resource: channels
    path: /channels/:id # default: /<page name with dashes>/:id
    fields: [name, private, created_by, created_at] # shown and edited, as on a resource page
    sections: [] # construct 2
```

A page of `kind: detail` shows one row of its `resource`, loaded with `get` by the key in the address. It is the
detail a resource page generates today (the row's title, its `fields`, the edit form, delete and the row actions,
each offered when its rule can hold for the viewer) at an address of its own, followed by its `sections`.

- The parameter: exactly one, spelled `:id`, as the last segment, after at least one literal segment
  (`/channels/:id`, `/library/albums/:id`). It is the row's key whatever the key field is called, as `{actor.id}`
  is the user's. Only a detail page's path takes one.
- With a list behind it: when the path is a resource page's path plus `/:id` and both pages are over the same
  resource, the detail page takes the place of that page's generated detail. The list's rows open it, it renders
  where the generated detail does (the right pane of a `split`, the full page of a `table` or a `board`) and it
  links back to the list. The resource page keeps `new`, and its own `fields` for the create form. It is part of
  that page: both backends nest the route inside the list's layout, behind the list's gate, so it opens for
  whoever the list opens for and takes no `access` of its own.
- On its own: any other path stands alone (`/authors/:id` over `users`, while the users table stays at `/users`),
  with its own `access`. One resource may have several detail pages, say the one inside its list and a public one
  at another address.
- Why a kind and not a key on the resource page: a row's page often has another audience than its list, a
  resource may need two of them, and some rows have a page but no list page at all.
- What it shows: without `sections`, exactly what the generated detail shows, the included reverse relations
  among them. `sections` replace those name lists.
- Keys: `resource`, `path`, `title`, `description`, `fields`, `refresh`, `sections`, and `access` when it stands
  alone. `layout`, `group_by`, `columns`, `filter`, `tiles` and `recent` belong to the other kinds and are refused
  by the schema, as `tiles` on a resource page is today.
- Where a row opens, one rule: a list's rows open its own detail, generated or taken over. A row shown anywhere
  else (a section, a dashboard's recent list, a relation's value in a column or a detail row) opens the first
  detail page declared over its resource, else the detail of the first resource page over it, else it is not a
  link. A link renders only when the viewer may open the target page. Today only a dashboard's recent rows link,
  to the detail of the first resource page.
- The sidebar lists pages, and a detail page needs a row, so a sidebar item cannot name one. Navigation built from
  rows is the 1.1 construct this page is the target of.
- Validation: M095 (new) a parameter that is not a trailing `:id` after a literal segment, a `:id` on a page of
  another kind, or a detail page whose path has none. M096 (new) a sidebar item that names a detail page. M081,
  M083 and M086 apply as on resource pages; M082 asks a detail page's resource for `get` only. M085 grows: beside
  two pages with one path, it refuses a detail page at `<path>/:id` when the resource page at `<path>` is over
  another resource, because that page's own detail lives there. M091 grows: `access` on a detail page that takes
  over a list's detail.
- IR: `PageIR.kind` gains `detail`; `PageIR.listPage` names the resource page it took over and that page carries
  `detailPage`; `path` keeps the `:id` spelling and each target writes its own.
- Both web backends: the component is `<Page>Page` in `generated/app/pages/<page>.tsx`, built from the code that
  writes `<Page>Detail` today. The route files:

  | Page                                                         | drizzle-next                                                                                | hono-trpc-vite                                                                            |
  | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
  | `channel` at `/channels/:id`, taking over `channels`         | `app/(app)/channels/[id]/page.tsx` renders `ChannelPage` where it rendered `ChannelsDetail` | `src/routes/channels.$id.tsx`, the same swap                                              |
  | `author` at `/authors/:id`, on its own                       | `app/(app)/authors/[id]/page.tsx`                                                           | `src/routes/authors.$id.tsx`                                                              |
  | a detail page under the path of a dashboard or a custom page | the same folder shape; Next nests nothing                                                   | `src/routes/<base>_.$id.tsx`, the flat-route spelling that keeps it out of the page above |

  No fixture nests one page's path under another's today, so the build proves the last row with a typecheck
  before relying on it; if it does not hold, that case is refused under M085 instead.

- Reference: the `kind: detail` lines in the page block, the rule for where a row opens, and the sentence that a
  sidebar item names a page without a parameter.

### 2. Sections: lists from other resources, filtered by the row

```yaml
pages:
  channel:
    kind: detail
    resource: channels
    path: /channels/:id
    sections:
      - resource: messages
        filter: { channel_id: "{row.id}" } # list filters of the section's resource; {row.id} is the page's row
        columns: [body, author_id, created_at]
        order: [[created_at, desc]] # one sortable field; default: the resource's own order
        limit: 50 # rows per page of the section; default 10, at most 200
        create: true # the add form, with channel_id preset from the row
      - { resource: channel_members, title: Members, filter: { channel_id: "{row.id}" }, columns: [user_id, role] }
```

Each section is a list its resource already serves, read with the list operation's own filters, sort and paging.
A section shows a title, a table of `columns`, a pager when there are more rows than `limit`, and one line when
there are none. Its rows open their page by the rule in construct 1.

- `filter`: equality over the resource's list filters, as on pages and tiles, and it must name the page's row: at
  least one key takes `"{row.id}"`, on a field that is a relation to the page's entity. The other keys take
  literals, `{actor.id}` or `{tenant.id}` under their own rules. A list that does not depend on the row belongs on
  a dashboard.
- `{row.id}` is the row's key. `{row.<field>}` for another field of the row is reserved and not accepted yet.
- `title`: defaults to the resource's name in Title Case. `columns`: default as on a resource page's list, without
  the fields the filter fixes.
- `order`: spelled like `list.order` and holding exactly one pair, because the list API sorts by one field
  (`sort=<field>:asc|desc`); the field must be in the resource's `sortable`.
- `limit`: the section's page size, 1 to 200, default 10. The pager reads the rest by page number.
- `create: true`: the section ends with the resource's create form, offered when the create rule can hold for the
  viewer, as `New` is on a resource page. It needs the resource's create operation. Default false: a section is a
  list unless it says otherwise.
- Presets, one rule for every create form opened from a filtered list, sections and resource pages alike: the
  context values in the filter (`{row.id}`, `{tenant.id}`, `{actor.id}`) are sent with the create and their fields
  leave the form; literal filters narrow the view and preset nothing. A resource page's filter presets nothing
  today, so forms on pages filtered by `{actor.id}` change with this round.
- Many-to-many: a section over the junction's resource, with the far side included, shows the far rows by their
  titles (an artist's tracks through `track_artists`). Reaching through the junction without it is declined below.
- A section whose list the viewer may not call at all is left out of the page; `refresh` on the page refetches its
  sections too.
- Validation: M097 (new) a section's resource does not exist or has no `list`; no key of its filter takes
  `{row.id}`; `{row.id}` on a field that is not a relation to the page's entity; `order` is not one pair over a
  `sortable` field; `create: true` on a resource without a create operation. M089 as today for a key that is not a
  list filter and for `{actor.id}`, and for `{row.id}` outside a section. M083 for unknown `columns`.
- IR: `PageIR.sections: SectionIR[]` (`resource`, `entity`, `title`, `filter`, `columns`, `order?`, `limit`,
  `create`); `PageFilterValue` gains `{ row: "id" }`.
- Both web backends: one list query per section (`page_size` from `limit`, the fixed filter with the row's key,
  `sort`), enabled once the row has loaded; the pager is the one tables use; the form reuses the create form's
  code and invalidates the section's query.
- Reference: the `sections` lines in the page block; the sentence about reverse relations in the detail pane
  gains "a detail page's sections replace them".

### 3. The tenant context: `{tenant.id}` and a switcher

```yaml
pages:
  projects: { resource: projects, layout: table, filter: { team_id: "{tenant.id}" } }
  home:
    kind: dashboard
    path: /
    tiles:
      - { resource: projects, label: Active projects, filter: { team_id: "{tenant.id}", status: active } }
      - { resource: channels, filter: { team_id: "{tenant.id}" } }
      - { resource: members, filter: { team_id: "{tenant.id}" } }
    recent: [{ resource: projects, filter: { team_id: "{tenant.id}" } }]
```

`{tenant.id}` is the key of the current tenant: the one row of the tenancy entity (`auth.tenancy.entity`) the
signed-in user has chosen to work in. It is a filter value beside `{actor.id}`, allowed wherever a filter is: a
resource page's `filter`, a tile's, a section's, and a dashboard's `recent` entries, which gain `filter` for it.
The model says only this much; the shell owns the choice.

- The switcher: using `{tenant.id}` anywhere turns the tenant context on. The shell then shows a switcher in the
  sidebar header: the current tenant's title and a menu of the rows the tenancy entity's resource lists for the
  user, which are their tenants when that entity's read rule is membership (`member:id`). Choosing one refetches
  every query filtered by it.
- Where the choice lives: in the browser, not in the address. It is remembered per tab, a new tab starts on the
  last choice, and a remembered tenant that is gone falls back to the first one listed. Queries filtered by the
  tenant wait for it; a user in no tenant sees an empty state that points at the tenancy resource's page.
- A filter, never a permission: the rules decide as before, a page without the filter still shows the rows of
  every tenant the user is in, and a detail page shows its row whatever tenant is current.
- Create forms preset the tenant relation by the rule in construct 2, so a project made on the filtered page
  lands in the current team.
- The limit: only a resource with a list filter on its tenant relation can be scoped. In the workspace fixture
  `projects`, `channels` and `members` can; `tasks`, `notes` and `milestones` reach the team through `project_id`
  and cannot. A list filter through a relation (`filters: [project_id.team_id]`) lifts this. It is an API
  construct for all three backends, named here and designed separately.
- Validation: M098 (new) `{tenant.id}` without `auth.tenancy`; on a field that is neither a relation to the
  tenancy entity nor that entity's own key; when no resource lists the tenancy entity; when the app has no
  sidebar to hold the switcher. M092 when the page is public, as for `{actor.id}`. M089 as today for a key that is
  not a list filter.
- IR: `PageFilterValue` gains `{ tenant: "id" }`; `recent` entries gain `filter`; `AppIR.tenant` (`resource`,
  `entity`, `labelColumn`) is present when any filter uses the context.
- Both web backends: `generated/app/tenant.tsx` exports `useTenant()` (the current tenant, the list and the
  setter, over the tenancy resource's list at page size 200 and browser storage) and `<TenantSwitcher />`. The
  fixed filter resolves `{ tenant: "id" }` from the hook and the query waits for it, as `{actor.id}` waits for the
  session. The sidebar scaffold renders the switcher in its header. Scaffolds are written once, so a project whose
  sidebar predates the round adds that one line, which the reference shows; until it does, the context works on
  the last or the first tenant without a control.
- Reference: `{tenant.id}` beside `{actor.id}`, the switcher, the limit above, and the sentence "Pages scoped to
  one team ... have no construct" leaves the declined list.

### 4. Access, missing rows and share links

```yaml
pages:
  author:
    kind: detail
    resource: users
    path: /authors/:id # no page sits at /authors: the page stands alone
    access: public
    fields: [name]
    sections:
      - resource: posts
        title: Articles
        filter: { author_id: "{row.id}", published: true }
        columns: [title, posted_at]
        order: [[posted_at, desc]]
  announcement:
    kind: detail
    # Announcement reads "public when published = true or owner:author_id or role:admin", hidden: not_found
    resource: announcements
    path: /news/:id # the announcements table at /announcements keeps its own detail for the editors
    access: public
```

Nothing new enters the grammar here. `access` on a detail page that stands alone is the plain predicate pages
have: who may open the page at all. Which row they see is the row's read rule, answered by the API when the page
loads it. A share link is what these compose to: a public detail page over a resource whose read rule has a
`public when` alternative. With `rules.hidden: not_found`, a row that is not shared answers like a missing one.

- The page renders the API's answer: 404 as a "Not found" card, for a missing row and a hidden one alike; 403 and
  401 as the "No access" and "Sign in required" cards the access gate has, the second being the row that is not
  public when the rule does not hide it. The generated detail prints the error in a note today and gets the same
  cards.
- A detail page inside its list cannot be the share link when the list is for members: the share link stands
  alone at another address, as `/news/:id` does beside `/announcements`.
- M092 grows: a detail page the public may open, on its own or inside a public list, needs a public alternative in
  its resource's read rule and in the read rule of each section's resource, as public resource pages and tiles
  do. `{row.id}` is fine on a public page, since the row is in the address; `{actor.id}` and `{tenant.id}` are
  not.
- A public page over the tenancy entity is the public address per tenant that r5-02 asked for.
- Reference: one sentence under `access`: it says who may open a page, the read rule says which row, and a public
  page over `public when` rows is a share link.

## Declined, with the sentence the reference gets

- The tenant in the address (`/t/:tenant/projects`, a route prefix): the choice lives in the browser. A link to a
  filtered list opens under the reader's own current tenant; a link to a row opens that row. A page that needs
  the tenant in its address is a detail page over the tenancy entity. A prefix would rewrite every link, the
  sidebar scaffold and the typed routes for one gain, list links that carry the tenant; `{tenant.id}` is spelled
  the same either way, so a later round can move the choice into the address without touching a model.
- Parameters other than a trailing `:id`: slugs and handles, two parameters, a parameter in the middle of a path.
  A detail page is one row by its key.
- `{row.<field>}` beyond the key (the other tasks of this task's project): reserved, not accepted.
- Sections that are not lists: counts and tiles on a detail page, charts, and a form with no list. The last is
  r5-01's request form, whose submissions the visitor may not read: a custom page.
- Sections with their own `access`: a public page lists only publicly readable resources; the members' view is a
  second detail page over the same resource.
- Chat and thread layouts, the block editor and the public reader: custom pages, scaffolded once.
- Loading older rows on scroll: sections page by number until `paging: cursor` lands (C2); a section's spelling
  does not change then.
- Comparisons in section filters (posts after a date): the range filters of A5, which sections inherit.
- List filters through a relation, and sections that reach through a junction to the far side: a list construct,
  not a page one.
- Navigation built from rows (a sidebar tree, recents): 1.1; the detail page is its target.
- Following a row's tenant: opening a row of another tenant does not switch the current tenant.

## Proof

- Fixtures: workspace gains WS-10: the `channel` detail page at `/channels/:id` taking over the `channels`
  table's detail, with a `messages` section (`create: true`, newest first, which adds `sortable: [created_at]` to
  `messages`) and a `channel_members` section; `filter: { team_id: "{tenant.id}" }` on the `projects`, `channels`
  and `members` pages; a `home` dashboard at `/` with tenant-filtered tiles and a filtered recent list. Blog gains
  FEAT-13: a public `author` page at `/authors/:id` on its own, with a section of the author's published posts; a
  `post` page at `/posts/:id` taking over the split `posts` page's detail, with a `comments` section and
  `create: true`; a public `announcement` page on its own at `/news/:id`, beside the `announcements` table and its
  detail, the share link over `public when published = true` with `hidden: not_found`.
- Scenarios prove the API side the pages rely on: each section's list call as the page sends it (the filter by the
  row, the sort, the page size); an anonymous visitor reads a published announcement and gets 404 for a draft; a
  user in two teams lists projects by `team_id` and gets one team's rows. The generated pages are proven by
  typecheck and the snapshots, as pages are today, and the walks of A1 run over both fixtures.
- Eval cases: `fx-ws-10-channel-page-and-team-home` and `fx-blog-13-author-and-article-pages` with the fixtures'
  diffs as oracles, plus three asks promoted from the rounds: `gen-r5-10-public-project-pages` (a public page per
  project with its tasks, 404 for a project that is not public), `gen-r5-02-team-public-roadmap` (a public address
  per organisation) and `gen-r6-03-team-dashboard-files` (a dashboard scoped to the current team). r5-01's request
  form stays an ask the agent must flag.
- `PageExpect` gains `kind: detail`, `sections` (the resources a page's sections must list, with alternatives) and
  `tenant` (some filter of the page uses `{tenant.id}`); `path` already matches `/channels/:id`.
- Gate: conformance 9/9 with the walks, snapshots updated, `pnpm evals --proposer oracle --no-full` green, rounds
  r1 to r7 graded again with `--resume` losing nothing, and a fresh round, with the page-per-row briefs the roadmap
  gives the generator, no longer reporting "pages with parameters".

## Size

Core: the `Page` schema (the `detail` kind, the path's parameter, `sections`, `filter` on `recent`), two filter
values, four new diagnostics (M095 to M098; M099 stays free) and six grown ones (M082, M083, M085, M089, M091,
M092), the `PageIR` and `AppIR` additions, the reference. Web (`packages/ts-common/src/web`): the detail page built
from the generated detail, sections with paging and the create form, the routes for taking over and for standing
alone, the one rule for where a row opens, the tenant module and its switcher, the preset rule, the cards for 404,
403 and 401. `gin-pgx`: nothing. Two fixture intents, five eval cases, `PageExpect`, snapshots. Larger than the
pages round: about that round for the detail page and its sections, and half again for the tenant context, which
can be built second and proven on its own.

## Choices confirmed at the review

1. `kind: detail` with the parameter always `:id` and always last, rather than a key on the resource page or
   named parameters.
2. Taking over by path: a detail page at a resource page's path plus `/:id` replaces that page's generated detail
   and shares the list's access; a page for another audience stands alone at another address.
3. `{row.id}` for the page's row in section filters; the exercises' sketches wrote `{param.id}`.
4. The current tenant in the browser, not in the address: no route prefix in this round.
5. `create: true` spelled out on a section, and the preset rule reaching existing resource pages filtered by
   `{actor.id}`.
6. No form-only section, so r5-01's request form stays a custom page.
7. One round: the tenant context is built with the detail page, second, and proven on its own.
