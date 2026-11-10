# Design: invites

**Status: built 2026-11-09** (round A4 of the road to 1.0.0, `docs/roadmap.md`). The design was approved as written
the same day, and the twelve choices at the end are settled. It was the note's second draft. The first was written
before rounds A2 and A3 were built, and the revision changed five things: the key moved from `auth.tenancy.invites`
to `auth.invites` and covers any membership, not only the tenant's; the invite became an entity and a resource the
compiler writes, in place of routes nested on the tenant resource; the `status` column went, because a row is a
pending invite; acceptance needs proof of the invite's email, which the draft's auto-accept on password sign-in did
not have; and the web part is a landing page plus pages the model declares, in place of a section built into the
tenant's page.

What changed from the design below while building: the grammar and the twelve choices are as written, and the text
below is corrected wherever it stated a fact the code decided otherwise. In core, `auth.invites` is absent from the
IR of a model without invites, an invite's `expires` is kept in seconds, `tenantChain` moved from the harness into
`ir.ts` (the tenant walk keeps its own copy), `/invite` is a reserved path in every app, M118 also refuses a
membership whose own fields clash with a field the invite writes and two invited memberships of one parent, a step
without `path.token` is the grown M072, and the renames rewrite `auth.tenancy` as well as `auth.invites`. In the
contract, the operations are `auth_invite` and `auth_invite_accept`, the answer's schema is `AcceptedInvite`,
invalid input on the token routes is 400 and not the 422 this note first named, and the invite create answers 401
without a session. In the TypeScript backends, the invite code is two files of its own in `packages/ts-common/src`
(`invites.ts` and `web/invite.ts`); `acceptPending` takes an optional third argument, the token that was used,
which only decides the order of the answer, and has three helpers beside it (`acceptWithToken` for the login,
`acceptInvite` for the accept route, `acceptedPath` for the redirect); a model with invites and no other provider
now emits `auth-providers.ts`; the accept route validates the account's body, and resolves its file references,
only when it makes the account; and `created` in every `http.ts` takes what rides beside `data`. On
`hono-trpc-vite` the token routes exist twice, as tRPC procedures and as two REST routes over one function, there
is no REST router for the invite create, the procedures answer `{ data, accepted? }` and `{ data, debug? }`, and
every procedure's error now carries its HTTP status, which moved `errors.ts`, `trpc.ts` and `app.ts` in every
snapshot of that backend. In the web app, the landing page and `/invite/accepted` render in the shell beside the
login pages, the route files are scaffolds written once, so the page itself is `generated/app/invite.tsx`, `/login`
takes `next` in every generated app, the link's origin is `OSL_APP_URL`, and `drizzle-next` without an `app`
section generates no pages. On `gin-pgx`, `httpx.JSON` is new in every snapshot, the mail is `email.Invite`, a
membership's created events reach the auth package through `auth.On<Membership>Created`, `AcceptPending` sorts the
invites before accepting, the tenant of a parent is found by one JOIN, and an accept body that cannot be read
counts as empty only when it is not JSON at all. In the harness, the invite walk runs before the walks that delete
and before the leak walk, and the fuzz walk demands exactly 404 on the token routes. In the fixtures, FEAT-14 adds
an `article_editors` resource and does not assert the inviter's name. In the evals, `ws1-invites-gap` keeps its id
and loses the `gap` tag, the trap is `ws11-join-link-trap`, the round generator gained two constraints about
invitations, and the clusterer gained the topics invite reminders and resending and invite list filters, an earlier
second pattern for files and media, and wider patterns for three topics (round r9, below).

Known limits, none of them driven by a scenario or a walk yet: the membership's created events on acceptance (no
fixture declares such an event); file fields of register on the accept route; the accept handler on `gin-pgx` for a
model with only a password provider or with none; the tenant of a parent more than one relation away from it; and
the provider callback's call to `acceptPending` with the redirect it computes, which are compiled and snapshotted
only (the backlog's `provider sign-in in scenarios`). The ceiling's 403 is asserted by the WS-11 scenario, not by
the walk. And `set_auth` replaces the whole block, as it always has: a diff that changes the providers of a model
with invites restates `invites`, or validation refuses it for the resources, pages and steps that would lose their
invite resource. One limit a round did name: the generated invite list filters by its parent alone, so a page
cannot narrow it to one role (the backlog's `invite list filters`, from round r9).

Proof: workspace WS-11 "invite a colleague by email" (team invites with a role under the inviter's ceiling, a page
of the pending ones, acceptance by the link, by a magic-link sign-in and by a password login carrying the token, an
account made by the accept, 43 steps) and WS-12 "invite a teammate to a private channel" (invites from the
channel's page, hidden with the channel, a team invite and a channel invite of one address accepted together, 29
steps), and blog FEAT-14 "co-authors by invite" (a junction with no role, acceptance by the link and by a
magic-link sign-in without it, 17 steps); conformance 9/9 with the six walks (blog 172 scenario tests per
TypeScript backend, 930 rule calls, 1206 probes and 14 invite checks over its one invited membership; workspace
270, 892 and 1475, with 19 home-team rows checked against an outsider and 25 invite checks over its two; todo 39,
with no invites to walk); 139 unit tests; the oracle gate 32/32 with `fx-ws-11-invites`, `fx-ws-12-channel-invites`
and `fx-feat-14-coauthor-invites`; and two cases run live, `ws1-invites-gap` (valid on the first attempt,
generating on every backend, its full run passing on `hono-trpc-vite`) and `ws11-join-link-trap` (declined, as the
join link is below). Rounds r1 to r8 graded again with `--resume`, 75 recorded proposals and no live call. With the
fixtures pinned where A3 left them (blog through FEAT-13, workspace through WS-10), all 75 keep the status,
failures, generation and metrics they had on the A3 build: 67 valid, 2 declined, 6 invalid. Unpinned, 63 keep their
status, the five that no longer applied at A3 still do not, and seven more no longer apply, because each carries a
whole `set_auth` block written before invites existed, which would drop the fixtures' `invites` and is refused (the
last of the known limits above). Nothing is lost to A4.

Round r9 (seed 58, ten intents, `--no-full`, $2.07 with generation) drew four invitation briefs from the two
constraints the generator gained with this round. Nine diffs were valid on the first attempt and generate on every
backend. The tenth, a reviewer invited to one draft, was cut off at the proposer's limit of 16,000 output tokens,
in the round and again on one retry; two of the other invitation briefs had come within 2,200 tokens of the same
limit. The limit was raised afterwards, to 64,000 by default and settable with `--max-tokens`, and the brief was
graded on a second retry (run `a4-r9-cap`, $0.61): valid on the first attempt at 23,828 output tokens, and
generating on every backend. It kept FEAT-14's invite entry and opened its rule to admins, gave `ArticleEditor` a
ranked `role` of editor and reviewer, hid drafts with `hidden: not_found`, and drove a reviewer's invite, accept,
read and comment, the reviewer's update refused, an admin's list and revoke, and another member's 403 on the
invite. The other three invitation briefs each declared `auth.invites` and drove an invite create and
`auth.invite_accept`: guests of one project on the workspace fixture, a third invited membership beside its two,
with a section of the pending invites on the project's page; workspaces with owners on the todo fixture; and
studios on an empty model. The round's first clustering did report invites and onboarding, once, and flagged it
with two more built topics, membership through any relation and rules on a field's value. Every line under them was
read, and none asks for what was built. The invites line asks for a reminder mail on an invite nobody accepted,
which the Declined section leaves out with resend, and is a topic of the clusterer now: invite reminders and
resending. The other two were misfiled: a collaborator who must already be a member of the studio is a write check
on a related row, and a draft's attachment readable by its URL is files and media. Three more lines moved to topics
that existed (write checks on related rows, provider sign-in in scenarios, sections beyond lists), and no line of
the 75 earlier results changed its topic. The second clustering reports eight clusters, none of them built and none
of them invites and onboarding. The retried brief added a ninth with its one line: the admins' page of invitations
cannot be limited to the reviewers', because the generated list filters by its parent alone. That is true of the
build and is not a request for invites, so it is a topic too, invite list filters, with an open entry in the
backlog. The round's own files (`round.yaml`, `compare-gaps.md`, `run/`) keep the first clustering and the nine
results of the round; its `gaps.md` and the backlog hold all ten.

Both hand-written applications surveyed for these notes have an invite: a row with an email, a role and a hashed
token that lapses after seven days, mailed as a link. They differ in how the invitee gets in, and the difference is
the lesson. One has a single way in: a public page that shows the team and the inviter, and a POST that accepts by
the mailed token. It never accepts on a GET, because mail scanners open links. The other has four ways in (the link
with a session, the link without one, sign-up through a provider with the token carried along, and a sweep by email
at every sign-in), and the four drifted. Only one of them compares the invite's email with the account's. One
accepts on the token alone. The sweep takes a provider's email whether or not the provider verified it, and its
comment describes a check the code does not make. The design below keeps the first application's care and the
second one's reach: several ways in, one function, one rule about proof.

## What was asked, in the agents' and the exercises' words

| Ask                                                                                                                                                                         | Where                                                   | Verdict                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| "Owners and admins invite people to a team by email. The invitee gets a link; accepting it makes them a member. Pending invitations are listed per team and can be revoked" | `ws1-invites-gap` (corpus, outcome any until round A4)  | answered, every clause                                                                                                |
| "Create a publication, invite others, and give each person a role: owner, editor or writer"                                                                                 | `gen-r1-02-publication-editorial-teams`                 | answered: the role rides on the invite                                                                                |
| "Each club gets its own private space with members, moderators, and an owner. People can join several clubs"                                                                | `gen-r7-10-club-forums`                                 | answered where joining is by invite; joining freely is a create rule on the membership, which exists                  |
| "needs an invitation that an account not yet registered can accept"                                                                                                         | backlog entry `invites and onboarding` (run 6, 3 cases) | answered: accepting creates the account                                                                               |
| "An admin invites people by email with a role; someone without an account accepts and lands in the workspace"                                                               | Slack SL-2, first half                                  | answered, with the switcher on the workspace joined                                                                   |
| "a workspace may also share a link anyone can use to join"                                                                                                                  | Slack SL-2, second half                                 | left out: an invite names one email                                                                                   |
| "guests see only what they are added to"                                                                                                                                    | Slack SL-1                                              | answered with round A2: a guest holds a low role in the team and is invited to each channel                           |
| "hold a role in each: owner, admin, member or guest"                                                                                                                        | Notion NO-1                                             | answered: the invite carries any role of the membership                                                               |
| "shared with named people or groups at a level"                                                                                                                             | Notion NO-5                                             | in part: a person named by email is invited into the page's share junction at a level; groups stay with their own gap |
| "may let chosen people edit a playlist with them"                                                                                                                           | Spotify SP-5                                            | answered where the person is named by email; adding a user who is already known is the junction's create              |
| "nobody below owner grants owner"                                                                                                                                           | Slack, and the backlog entry `role changes`             | on invites only (choice 7); the rest waits for 1.1                                                                    |
| A guided first-run wizard after joining                                                                                                                                     | hand-written applications                               | a custom page, not a construct                                                                                        |
| Seat limits on the plan                                                                                                                                                     | hand-written applications                               | a before-create hook on the invite resource; billing is declined                                                      |

The backlog entry `invites and onboarding` is answered in full by the first four rows. Of the exercises, Slack asks
for invites outright. Notion and Spotify ask for the neighbouring thing, sharing one row with named people: round
A2 gave that a rule, and this round gives it a way in for someone named by email.

## Constructs

The API parts below apply to all three backends. The web parts apply to the two web backends; `gin-pgx` is API-only
and ignores `app`, as today.

### 1. The key: `auth.invites`

```yaml
auth:
  identity: User
  providers: [credentials, magic_link]
  tenancy: { entity: Team, membership: TeamMember, role_field: role, creator_role: owner }
  invites:
    TeamMember: {} # who may invite: TeamMember's own create rule; the link lasts 7d
    ChannelMember: { rule: "member:channel_id.members:admin", expires: 14d }
```

`invites` maps a membership entity to `{ rule?, expires? }`, and nothing else is accepted in the entry.

- A membership entity is the tenancy's `membership`, or a junction that a `member:` path can end in (round A2): an
  entity with one relation to the identity and one to its parent, the row people are members of. The tenancy names
  its parts itself. For a junction, `membershipRelation` in `packages/core/src/model.ts` already answers the two
  relation fields, the ranked role and whether the pair is unique, so the invite reads them from there. A junction
  that is a membership in both directions, such as a follow between two users, has no one parent and takes no
  invites.
- The key sits under `auth` and not under `auth.tenancy`, where the first draft had it, because a junction needs
  sign-in but no tenancy. A model without tenancy can invite co-authors to an article.
- `rule` says who may invite, list the pending invites and revoke them. Its default is the membership entity's own
  `create` rule: an invite is a membership create that waits for its user, so whoever may add a member may invite
  one. For `TeamMember` in the workspace fixture that is `member:team_id:admin`, which is "owners and admins
  invite" as asked.
- `expires` is how long the link lasts, in the durations timers use (`30m`, `48h`, `7d`). Default `7d`, the figure
  both hand-written applications chose.
- Any provider will do. With `credentials` an invitee sets a password when accepting; with `magic_link` or OAuth
  alone the account signs in that way afterwards.

### 2. The invite: an entity and a resource the compiler writes

For each entry the compiler adds an entity and a resource that the model file does not declare, the way
`password_hash` arrives with credentials. They are named after the membership's parent: `TeamInvite` in the table
`team_invites` behind the resource `team_invites`, and `ChannelInvite` behind `channel_invites`.

| Field               | What it is                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | the key, as the membership's                                                                                                      |
| the parent relation | under the membership's own field name (`team_id`, `channel_id`), required, cascade                                                |
| `email`             | required, an email, stored trimmed and in lower case as sign-in compares it                                                       |
| `role`              | the membership's role field with its values and default, when it has one (the tenancy's `role_field`, a junction's `ranked` enum) |
| `invited_by`        | a relation to the identity named `inviter`, read_only, set to the caller, cascade                                                 |
| `token_hash`        | hidden, unique                                                                                                                    |
| `expires_at`        | read_only, set from `expires`                                                                                                     |
| `created_at`        | as everywhere                                                                                                                     |

- Unique on the parent and the email: one pending invite per address and parent.
- No status column. A row is a pending invite: accepting deletes it, and revoking is the resource's `delete`. The
  first draft kept `pending`, `accepted` and `revoked` rows and a list that filtered them; one of the hand-written
  applications deletes the row once it is answered, and nothing then has to keep a status true. A lapsed row stays,
  showing its `expires_at`, until it is revoked or a new invite to the same address replaces it. A history of who
  was invited belongs to the audit trail (round C3).
- Rules: `read`, `create` and `delete` are the invite rule, `update` is `none`, and `hidden` is the parent's, so
  where a private channel answers 404 to outsiders, a get or a delete of one of its invites does too.
- The resource offers `list`, `get`, `create` and `delete`, with a list filter on the parent relation, the inviter
  included and the newest first.
- From validation onward it is an entity and a resource like any other. Pages and sections list it,
  `TeamInvite.created` can be declared as an event, it gets the user-owned hooks every resource gets, the OpenAPI
  document describes it, and the conformance walks cover it. No diff op can change it: its shape follows the
  membership.
- How: one function, `expandInvites(model)`, run at the top of `validateModel` and of `compile`, the two entry
  points every caller goes through. It returns the model with the entities and resources added.

Why not routes nested on the tenant resource, as the first draft had (`POST /api/teams/{id}/invites`): that shape
needed a tenant resource to hang on, so it could not serve a channel; it was a route family of its own that the
walks, the pages and the scenario steps would each have had to learn; and A3's pages and sections list resources,
so a resource is what lets a model show its pending invites without web code written for invites alone.

### 3. Sending an invite

`POST /api/team_invites` with `{ team_id, email, role? }`, under the invite rule, and 401 without a session. The
resource's generated create is replaced by one that does this, in order:

1. The role ceiling (choice 7). Where the membership's roles rank, the role granted may not rank above the role the
   caller's own membership of that parent holds; the same rank is allowed. A caller who passes the rule without a
   membership of the parent (a global `role:admin`, or a channel's creator through `owner:channel_id.created_by`)
   is not capped. 403 otherwise. Without `role` in the body the invite takes the role field's default.
2. 409 `invite_exists` when a live invite to that address exists for the parent, and 409 `already_member` when the
   address belongs to a member of it. A lapsed invite to the address is replaced.
3. A random token, stored as its SHA-256 hash the way magic links store theirs, with `expires_at` and `invited_by`
   set.
4. The mail, through the email adapter: the parent's display value in the subject, the inviter's display value, the
   role, the link `OSL_APP_URL/invite/<token>` and the day it lapses. The row is kept only if the mail was handed
   to the adapter.
5. 201 with the row, never the token. When emails are captured (the tests' mode) the reply carries
   `debug: { token, url }` beside `data`, so the row keeps its shape. It is the pair the magic link's reply
   carries.

The before and after hooks of the invite resource run around this as around any create, which is where a seat limit
goes. Revoking is `DELETE /api/team_invites/{id}` under the same rule, and the list is
`GET /api/team_invites?team_id=...`.

### 4. Proof of the email, and the one place acceptance lives

The rule: an invite becomes a membership only when the person coming in has proven the invite's email, and only in
the account whose email it is.

The first draft accepted "the caller's pending, unexpired invites by email" on register and on login as well.
`register` does not verify an email, so that would hand the role to whoever registers the invited address first. It
is the second application's sweep, with the same hole. What proves an email:

- the mailed token, because it reached that mailbox;
- a magic-link verify, for the same reason;
- an OAuth callback whose provider reports the email as verified.

A password proves nothing about a mailbox, so a password sign-in accepts only when it is handed the token.

The one place is `acceptPending(user, provenEmail)`. It does nothing unless the proven email is the account's own.
For every live invite to that address, across all invited memberships, it inserts the membership (the parent, the
user, the invite's role) and deletes the invite in one transaction, and it answers what it accepted. A membership
that already exists is left as it is and the invite is still used up. It is a system insert, like the membership a
tenant's creator gets: no access rule and none of the membership resource's hooks, but the membership's `created`
event is dispatched as a direct add dispatches it. It is written once in `packages/ts-common/src/invites.ts` for
both TypeScript backends, which emit it into `generated/auth-providers.ts`, and once in Go, and nothing else makes
a membership from an invite. Every way in ends there:

| Way in                                                   | What proves the email         | Caller                                     |
| -------------------------------------------------------- | ----------------------------- | ------------------------------------------ |
| magic-link verify                                        | the link reached the address  | `verifyMagicLink`                          |
| OAuth callback                                           | the provider's verified email | `oauthCallback`                            |
| password login with `invite: <token>` in the body        | the token                     | `login`, through `acceptWithToken`         |
| the accept route, with a session or creating the account | the token                     | the accept handler, through `acceptInvite` |

The two callers that hold a token hand it on as a third argument, `acceptPending(user, provenEmail, usedToken)`,
which only decides the order of the answer: the invite whose link was opened comes first.

- `register` is unchanged. Registering with an invite is the accept route, which takes the same body and already
  holds the proof.
- A login whose `invite` token is unknown, lapsed or for another address still signs in, since the credentials were
  good; it accepts nothing, and the reply shows that.
- One proof accepts every live invite to the address. Someone invited to a team and to a channel joins both through
  whichever link they open first, or at their next magic-link sign-in with no link at all.
- There is no consent step. That is the roadmap's auto-accept, and it matches a direct add, which asks nobody
  either. An invitee who does not want a membership deletes it where the model's rules let them.

What the rule does not close. Registering with a password does not prove the email, so someone can register an
address before its owner arrives and keep the password. If the owner later reaches that account by magic link or
through a provider, both hold it, and an invite accepted there serves both. This is so today without invites;
invites raise what it is worth. With `credentials` as the only provider it is a lockout instead: the owner cannot
sign in to the account, so nobody accepts. Closing it takes a verified registration, which belongs to the open
entry `sign-in flow settings` (choice 12).

### 5. The token routes

Both are public and live under `/api/auth`.

`GET /api/auth/invites/{token}` is the lookup behind the landing page. It never accepts, because mail scanners open
links. 200 answers the parent's entity and display value, the role, the inviter's display value, the email masked
(`b•••@example.com`), `expires_at` and `account`, which says whether the address already has an account. A token
that is unknown, used or revoked is 404, a lapsed one is 410, and neither says more.

`POST /api/auth/invites/{token}/accept`:

| Caller                                                             | Answer                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| a session whose email is the invite's                              | accepts, 200                                                    |
| a session under another email                                      | 403 `invite_email_mismatch`; nothing changes                    |
| no session, and the address has an account                         | 401 `sign_in_required`                                          |
| no session, and the address has no account                         | creates the account from the body, signs it in and accepts, 201 |
| any, with a token that is unknown, used or revoked                 | 404                                                             |
| any, with a lapsed token                                           | 410                                                             |
| no session, no account, and a body the account cannot be made from | 400, with the issues as `register` lists them                   |

- The token never signs anyone into an account that exists. The second application signs in whoever holds the link;
  here a forwarded link opens nothing that the mailbox's owner already has.
- Creating the account takes the body `register` takes, or would take where `credentials` is not declared, without
  the email, which is the invite's: the identity's fields a client may set, validated as `register` validates them,
  and `password`. The password is required where `credentials` is the only provider, optional where another
  provider can sign the account in later, and refused where `credentials` is not declared. The token has proven the
  address, so the account is the invitee's from its first minute. This also gives identities that M123 warns about,
  the ones with required fields a magic link cannot fill, a way in besides registering first.
- The reply has the shape of a sign-in: `data` is the user as `me` answers it, with
  `accepted: [{ entity, id, role, tenant }]` beside it. `login` and the magic-link verify carry the same `accepted`
  when they accepted something. `entity` and `id` name the parent row, and `role` is there where the membership has
  one. `tenant` is the id of the tenant that row belongs to: the row itself for the tenancy's membership, the
  tenant reached through the parent's required relations for any other, and null where there is none. The invite
  whose token was used comes first, then the others, oldest first.

### 6. The web app: the landing page and where the invitee lands

The shell gains one page and one function; the rest is declared.

- The landing at `/invite/<token>`, generated like `/login/verify`: public, rendered in the shell beside the login
  pages, not a page the model declares. It is not a declared `access: public` page because it shows no row of a
  resource: it reads by token, and what it may show is what the lookup answers. `/invite` and every path under it
  join the reserved page paths. The route files are scaffolds, written once, so what the page does lives in the
  generated `generated/app/invite.tsx`, which every `osl generate` rewrites.
- Its states follow the lookup and the session. Signed in with the invited email: the parent, the role, the inviter
  and an Accept button. Signed in under another email: which address the invite is for, masked, and a way to sign
  out; no button. Signed out with no account: the form that creates it (the identity's fields, and a password where
  `credentials` is declared), and submitting it is the accept call. Signed out with an account: "sign in to
  accept", linking to `/login?next=/invite/<token>`, with the provider buttons where OAuth is declared. A 404 and a
  410 each get a card that says the invite is no longer valid or has lapsed.
- `/login` gains `next`, a path of the app itself; anything else is ignored. It gains it in every generated app,
  with or without invites. When `next` is an invite landing, the login form sends its token as `invite`, so a
  password sign-in accepts in the same call.
- Where the invitee lands. Every reply with `accepted` (the accept call, a login, a magic-link verify) goes to one
  function. It takes the first entry and, when the entry has a tenant that the user's tenant list now holds, makes
  that the current tenant, the choice A3's switcher keeps under `osl.tenant`. Then it opens the parent's row at the
  address A3's rule for where a row opens gives, or `/` when no page shows it. The OAuth callback is a redirect and
  cannot carry a body: when it accepted something it redirects to `/invite/accepted` with the first entry's entity,
  id and tenant in the query, and that route runs the same function. When it accepted nothing it returns where the
  flow asked, as today.
- The pending list and the invite form are pages the model declares, because invites are a resource. A resource
  page gives the list, the form and revoke, which is the row's delete:

```yaml
pages:
  invites:
    resource: team_invites
    layout: table
    filter: { team_id: "{tenant.id}" } # the current team's invites; New presets the team, by A3's preset rule
    columns: [email, role, invited_by, expires_at]
```

- A section on a detail page gives the list and the form beside the row they belong to. A section has no row
  delete, so a model that wants revoke in the app declares the resource page as well, and the section's rows open
  in it.

```yaml
sections:
  - resource: channel_invites
    title: Invites
    filter: { channel_id: "{row.id}" }
    columns: [email, role, expires_at]
    create: true
```

- Who sees them. Where a rule is a membership, the generated app offers the control to any signed-in viewer and the
  API decides. That is so for every `member:` rule today, and invites do not change it: a team member who may not
  invite sees the page with no rows, because a list holds only the rows its caller may read, and a form the API
  answers with 403.
- `gin-pgx` generates none of this. The mailed link points at `OSL_APP_URL/invite/<token>`, which is the front
  end's to serve, as the magic link's `/login/verify` is.

### 7. How invites meet the rest of the model

- **Membership through any relation (A2).** An invite to a channel is the same construct a second time. The parent
  is the entity on the far side from the identity (`Channel`, through the relation whose `reverse` a `member:` path
  ends in), the role is its `ranked` enum, and the default rule is the junction's create rule. For `ChannelMember`
  in the workspace fixture that is `owner:channel_id.created_by or member:channel_id.members:admin`, which reads on
  `ChannelInvite` unchanged because the invite has `channel_id` too. A junction without a ranked enum invites
  without a role.
- **One invite, one membership.** A channel invite makes a channel member and nothing else. In the workspace
  fixture a private channel is read through `member:members`, so the API serves the channel to an invitee from
  outside the team. The generated app lists tenants by tenancy membership, though, so that person has no team in
  the switcher and the pages filtered by `{tenant.id}` show them the no-tenant state. An application that wants
  outsiders in one channel invites them to the team in a low role as well, which is Slack's guest, and one opened
  link accepts both. An invite that brings a second membership with it is left out.
- **Detail pages and sections (A3).** The pending list is a section or a resource page, as construct 6 shows. After
  accepting, the invitee lands on the parent's detail page where the model has one.
- **The tenant context (A3).** After accepting an invite to a tenant, the switcher is on that tenant. After
  accepting an invite to a channel, it is on the channel's team when the invitee is a member of that team, and
  stays where it was otherwise. With several invites accepted at once, the one whose link was opened decides.
- **Hidden rows.** The invite inherits the parent's `hidden`; a create by someone the rule refuses is still 403, as
  on any entity. Before accepting, the lookup by token is the one place an invitee learns the parent's name, and
  they hold the token. The parent itself stays behind its read rule: a hidden channel answers 404 to its invitee
  until they accept.
- **Before and after.** Before accepting, the invitee sees what the lookup answers and nothing more, and no list
  shows a person the invites waiting for them. After accepting, the session they already have sees the membership
  on its next request, because sessions load memberships per request. Lists that were empty hold the row, and
  nobody signs in again.

### 8. Scenario steps

- The invite resource takes the steps any resource takes: `team_invites.create`, `team_invites.list`,
  `team_invites.get`, `team_invites.delete`.
- Two auth steps join `AUTH_STEP_OPS`: `auth.invite`, the lookup, and `auth.invite_accept`, both with
  `path: { token }`; a step without it is M072, the diagnostic a missing path id already gets. An `auth.login` body
  may carry `invite`.
- The token comes from the create reply (`capture: { token: debug.token }`), and `emails.sent` shows the mail.
- What a scenario cannot do. Every actor is registered before a scenario starts, so a scenario invites an address
  no actor has in order to reach account creation. A step without `as:` uses a fresh client, so the account an
  anonymous accept creates is proven by a later `auth.login` and by the inviter's list of members. No step moves
  the server's clock, so expiry is proven by a walk (see Proof). No step signs in through a provider (see the two
  open entries below).

## Mapping

**Core** (`packages/core`):

- `model.ts`: the `invites` map on `Auth`; `expandInvites`; `/invite` and the paths under it among the reserved
  page paths; the two step ops; the diagnostics below.
- `ir.ts`: `AuthIR.invites`, one record per entry (the membership, its parent and the two relation fields, the role
  values in rank order, the rule, `expires` in seconds, the invite's entity and resource, and `tenantPath`, the
  relations from the parent to its tenant, computed by `tenantChain`, which moved into core for it; the tenant walk
  keeps its own copy); a mark on the invite resource's create, `invite: <Membership>`, so each backend writes
  construct 3 in place of the generated one; the paths of the two steps.
- `openapi.ts`: the invite resource as any resource, with 409 on its create; the two token routes, `auth_invite`
  and `auth_invite_accept`, with 200, 201, 400, 401, 403, 404 and 410 (invalid input is 400 everywhere in the
  contract, not the 422 this note first named); `invite` on the login body; `accepted`, a list of the new schema
  `AcceptedInvite`, on the replies of login, magic-link verify and accept.
- `diff.ts`: the renames below.
- `reference.ts` and `docs/model.md`: the `invites` key, the entity and the resource it writes, the proof rule, the
  scenario steps, the declined sentences, and a new line where the reference now says to keep pending invites in an
  entity of one's own.

**Shared TypeScript** (`packages/ts-common/src`):

- `invites.ts`, a file of its own: `issue<Parent>Invite` for each entry (the ceiling, the two 409s, the token, the
  mail), `lookupInvite`, `acceptPending`, the two callers' helpers `acceptWithToken` and `acceptInvite`, and
  `acceptedPath`, the redirect of the OAuth callback. `auth-providers.ts` emits it into
  `generated/auth-providers.ts` with the calls from `verifyMagicLink` and `oauthCallback`. Both TypeScript backends
  emit this one file, so they cannot differ.
- `email.ts`: the invite mail.
- `tests.ts`: the two steps and `invite` on a login step.
- `web/invite.ts`, a file of its own: the landing, the accepted page, the function that lands the invitee
  (`useLandInvitee`) and the two route files. `web/shell.ts`: `next` on the login page. `web/client.ts`: the lookup
  and accept calls and the `Accepted` type. `web/routes.ts` needed nothing.

**`drizzle-next`** (`packages/backend-ts`):

- `auth.ts`: `app/api/auth/invites/[token]/route.ts` and `app/api/auth/invites/[token]/accept/route.ts`; the login
  route reads `invite`; the OAuth callback redirects to `/invite/accepted` when it accepted something.
- `resources.ts`: the invite resource's create calls `issue<Parent>Invite` between its hooks.
- `index.ts`: the files above join the output. `http.ts`: `created(data, extra)`, so a 201 can carry `debug` or
  `accepted` beside `data`.
- The web target: `app/(app)/invite/[token]/page.tsx` and `app/(app)/invite/accepted/page.tsx`.
- Migrations and the Drizzle schema need nothing of their own: the invite arrives as an entity.

**`hono-trpc-vite`** (`packages/backend-vite`):

- `server.ts`: the tRPC procedures `auth.invite` and `auth.invite_accept` beside `magic_link_verify`, and the two
  token routes as REST as well, because the mailed link's page and a client outside tRPC both reach them; one
  function, `acceptInviteAs`, is behind both. `invite` on the login. The custom create is the tRPC procedure; this
  backend has no REST router for resources, which the note first assumed.
- A procedure answers 200 or an error, so the affected ones carry the extra beside the row: the invite create
  answers `{ data, debug? }`, and login, the magic-link verify and the accept answer `{ data, accepted? }`. Errors
  carry their HTTP status through tRPC for every procedure now, which the 409 and 410 needed; that changed
  `errors.ts`, `trpc.ts` and `app.ts` in every snapshot of this backend.
- The web routes, `src/routes/invite.$token.tsx` and `src/routes/invite.accepted.tsx`, come from the shared
  `web/invite.ts`; `web.ts` needed nothing.

**`gin-pgx`** (`packages/backend-go`):

- `invites.ts`, a file of its own, emitted into `generated/auth/providers.go`: `Issue<Parent>Invite`,
  `AcceptPending` and the type `Accepted`, the handlers `Invite` and `InviteAccept`, and `acceptWithToken`, which
  `Login` calls. `AcceptPending` is called from the magic-link verify and the OAuth callback.
- `email.ts`: the invite mail, `email.Invite`. `resources.ts`: the custom create. `httpx` gains `JSON`, for a reply
  that carries more than `data`, in every Go snapshot.
- No web. The Go `generated/client` package is the generic client of the contract tests and the seed program, with
  one `Request` for every route, so it gained nothing; the note first gave it two calls and the `Accepted` type.

**Diagnostics.** Four are new and four grow. M099, M119 and M124 to M129 stay free.

| Number |       | Says                                                                                                                                                                                                            |
| ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M115   | new   | an entry of `auth.invites` names an entity that is not a membership (neither the tenancy's nor a junction a `member:` path can end in), or one that is a membership in both directions, so it has no one parent |
| M116   | new   | the membership cannot be made from an invite: it has a required field without a default besides its two relations and its role, or no unique pair over its two relations                                        |
| M117   | new   | the invite rule cannot be read on the invite: it names a field the invite does not have (a membership's `owner:user_id`), or it is `public`. Says to declare `rule`                                             |
| M118   | new   | a name is taken: the model declares `<Parent>Invite`, its table or the resource `<parent>_invites`, the membership's own fields clash with a field the invite writes, or two invited memberships share a parent |
| M072   | grown | a step `auth.invite` or `auth.invite_accept` without `path.token`                                                                                                                                               |
| M084   | grown | `/invite` and every path under it are reserved for the shell                                                                                                                                                    |
| M121   | grown | the steps `auth.invite` and `auth.invite_accept`, and `invite` on a login step, need `auth.invites`                                                                                                             |
| M123   | grown | where invites are declared, its text names accepting an invite as a second way in for the users a magic link or a provider cannot create                                                                        |

**Diff ops.** None is new.

- `set_auth` carries `invites`, as it carries the rest of the block. Adding an entry adds the table and the routes;
  removing one drops them, and the contract walk takes the `set_auth` as the explanation, as it does for a provider
  that goes.
- `rename_entity` on an invited membership rewrites its key in `invites`. On the parent it also renames the
  invite's entity through the rename map, so the migration renames the table and keeps its rows.
- `rename_field` on the membership's parent relation or its role field is mirrored on the invite, so the migration
  renames the column. It rewrites an explicit invite `rule` as it rewrites any rule.

## Two open entries near this construct

**`role changes`** (2 cases; in the 1.1 table of the roadmap) stays out, except for one piece. What a client may
write into a role field would depend on who they are, which takes a second grammar for before-and-after values. The
piece that comes with invites is the ceiling of construct 3, and it needs no grammar, because the compiler writes
that create. Capping a direct add of a member is not brought in: a cap on create alone is walked around through
update, and capping both is most of `role changes`. So in the workspace fixture an admin can still add an owner
directly. The ceiling keeps an invite from being a second way around once that entry is built, and it is a full
guarantee today for a model that reserves direct adds for owners and lets admins invite.

**`provider sign-in in scenarios`** (3 cases in round r8) stays out. It is harness work with a design of its own: a
provider the harness plays, what its issuer answers, and how a step follows the redirect. It would cover the first
sign-in through a provider and linking by email, neither of which is an invite. In this round the OAuth callback
gains one call to `acceptPending`. That call site is compiled and snapshotted on three backends by the blog
fixture, and the function it calls is driven by the other three ways in, but no scenario signs in through a
provider and accepts. When that entry is built, an invite accepted through a provider is one of its first
scenarios.

## Declined, with the sentence the reference gets

- **A join link not bound to an email.** "An invite names one email. A link anyone may use to join is a shared
  secret, which the model does not have." The Slack exercise asks for it; it stays with the open entry
  `shared secrets and access codes`.
- **An inbox of waiting invites, and declining one.** "No list shows a person the invites waiting for them." A
  password account has not proven its email, so the list would show them to whoever registered the address.
- **Resend.** "To send an invite again, revoke it and invite again. A new invite replaces a lapsed one."
- **An invite that brings a second membership.** "One invite, one membership. Invite to the team and to the
  channel; one link accepts both."
- **Verified registration.** "Registering with a password does not prove the email." See what the proof rule does
  not close, in construct 4, and choice 12.
- **A control hidden by the viewer's role.** "The generated app offers a control to any signed-in viewer where the
  rule is a membership; the API decides." True of every such rule today and not changed here.
- **The rest of role changes.** Changing a member's role under a ceiling, keeping the last owner, transferring
  ownership.
- **An onboarding wizard.** "A custom page, opened after the invite."
- **Seat limits.** "A before-create hook on the invite resource." Billing is declined as a whole.
- **Mail templates.** The invite mail is the adapter's plain text, as the magic link's is.
- **A history of invites.** "An accepted or revoked invite is gone." The audit trail (round C3) is where it will
  show.

## Proof

**Workspace WS-11, "invite a colleague by email".** The diff: `set_auth` with `invites: { TeamMember: {} }`, a page
`invites` over `team_invites` filtered by `{tenant.id}`, and its sidebar item. The scenario, with alice as the
owner of a new team:

- alice invites bob as admin: 201, the row without a token, the token captured from `debug`, and `emails.sent`
  shows the mail to bob.
- dana, outside the team, gets 403 on inviting and an empty list of the team's invites.
- The lookup answers the team's name, the role and `account: true`. An accept with no session is 401. carol's
  accept with bob's token is 403.
- bob's `teams.get` is 403; his accept is 200 with the team in `accepted`; his `teams.get` is 200 on the session he
  already had. `members.list` shows bob as admin, the team's invites are empty, and the token's lookup is 404.
- bob, now an admin, invites someone as owner: 403. As member: 201. The same address again: 409. alice inviting
  bob's address: 409.
- carol is invited and joins by magic link: request, verify, `accepted` in the reply, and no invite token used.
- An address without an account is invited. The lookup says `account: false`; an accept with no session, a name and
  a password is 201; a login with that password is 200; `members.list` has grown.
- Another new address is invited, registers by password and is not a member. A login with `invite` joins. A login
  with a wrong `invite` is 200 and joins nothing.
- alice revokes an invite; its lookup is 404.

**Workspace WS-12, "invite a teammate to a private channel".** The diff: `ChannelMember: {}` joins `invites`, and
the channel page of WS-10 gains an Invites section with `create: true`. The scenario:

- bob is in the team and not in the private channel: `channels.get` is 404. alice, the channel's admin, invites him
  as member.
- bob's get of the invite by its id is 404 and his own attempt to invite is 403. His accept is 200 with the channel
  first in `accepted` and the team as its `tenant`. Then `channels.get` is 200 and he posts a message.
- bob, a member and not an admin of the channel, gets 403 on inviting.
- dana is outside the team. alice invites her to the team as member and to the channel. dana's one accept, with the
  channel's token, answers both in `accepted`, the channel first, and she reads the team and the channel.

**Blog FEAT-14, "co-authors by invite".** No tenancy, no role, and OAuth declared. The diff: a junction
`ArticleEditor` between `Article` and `User` (the relation to the article names the reverse `editors`),
`or member:editors` on the article's update rule, a resource `article_editors` over the junction, and
`invites: { ArticleEditor: {} }`, whose rule defaults to the junction's create rule, `owner:article_id.author_id`.
The scenario: bob's edit of alice's article is 403; dave's attempt to invite to it is 403; alice invites bob; bob
accepts, with `tenant: null` in `accepted`; his edit is 200 and his delete is still 403; erin is invited and joins
by magic link. The snapshots show the `acceptPending` call in the OAuth callback on all three backends.

**Conformance walks.**

- The rule walk learns the invite's create: a fresh address each time and a role no higher than the caller's, so
  the rule is what decides the answer.
- The tenant walk covers the invite like any row that reaches a tenant through a relation.
- The leak walk already forbids `token_hash`. It also checks that no read of an invite carries a token and that the
  lookup's email is masked.
- The fuzz walk learns the two token routes: any string as the token is a 404, never a 500.
- The contract walk takes `set_auth` as the explanation for the invite resource's paths and for
  `/api/auth/invites/*`.
- A sixth walk, `invite`, for what a scenario cannot reach. An unknown token is 404. A row aged through the
  database handle is 410 on the lookup and on the accept. A session under another email is 403 and changes nothing.
  The invited actor's accept is 200 and the membership is there. A second accept is 404. A password login without
  the token joins nothing. A model without invites skips it.

**Unit tests in core.** The shapes `expandInvites` writes for a tenancy membership, a ranked junction and a
junction without a role; M115 to M118; the grown M084, M121, M072 and M123; the default rule and an explicit one;
the three renames; the stored model left as it was written.

**Evals.**

- `fx-ws-11-invites`, `fx-ws-12-channel-invites` and `fx-feat-14-coauthor-invites`, with the fixtures' diffs as
  oracles.
- `ws1-invites-gap` is promoted from outcome any: it expects `invites` on `TeamMember`, no invite entity declared
  by hand, a 403 and a 201 among its scenario steps, and the steps `team_invites.create` and `auth.invite_accept`.
  It keeps its id, so earlier runs still line up with it, and loses the `gap` tag.
- A trap for the join link, `ws11-join-link-trap`, which expects the limit to be flagged.
- `Expect.auth` gains `invites`, the memberships that must have an entry.
- The two generated cases of the table at the top are regraded with `--resume`.

**The gate.** Conformance 9 of 9 with six walks, the snapshots, the earlier rounds regraded with `--resume` losing
nothing, and a fresh round that no longer reports `invites and onboarding`. Then the backlog entry becomes `built`,
the entry `provider sign-in in scenarios` gains a line about the callback's call site, and SL-2 in the Slack
exercise is updated.

## Size

About what the roadmap row says: the hidden-rows round plus web work. Against the first draft, the
entity-and-resource form removes a family of nested routes and the section built into the tenant's page, since
lists, pages, steps, OpenAPI and most of the walks come from machinery that exists. It adds the custom create, the
proof rule at four call sites, a walk and a third fixture intent. The A4 row of the roadmap stands as written.

## Choices confirmed at the review

All twelve were confirmed as recommended on 2026-11-09. Each alternative stays here for the record.

1. Where the key lives. Recommended: `auth.invites`, keyed by membership entity, for the tenancy's membership and
   for any junction of round A2. The alternative: the first draft's `auth.tenancy.invites`, for the tenant only,
   with channels and shares left for later.
2. What an invite is. Recommended: an entity and a resource the compiler writes, so pages, sections, events, hooks,
   steps and walks treat it like any other. The alternative: routes nested on the tenant resource, as first
   drafted, or an entity the model declares and marks.
3. No status column. Recommended: a row is a pending invite; accepting or revoking deletes it, and its history
   waits for the audit trail of round C3. The alternative: keep `pending`, `accepted` and `revoked` rows.
4. Proof of the email. Recommended: only the mailed token, a magic-link verify or a provider's verified email
   accepts, and a password login accepts when it carries the token. The alternative: the first draft's accept by
   email on every sign-in, which hands the role to whoever registers the address first.
5. No consent step. Recommended: one proof accepts every live invite to the address, which is the roadmap's
   auto-accept. The alternative: each invite accepted by its own link only, with an inbox for the rest.
6. Creating the account. Recommended: the accept route creates it from the registration body, and the token never
   signs anyone into an account that exists. The alternative: no account creation on accept; the invitee registers
   first and opens the link again, two steps where one would do.
7. The role ceiling. Recommended: on the invite create only: nobody invites above their own rank. The alternative:
   no ceiling until `role changes` is built, or bring the ceiling on membership create and update into this round,
   which is most of that entry.
8. Provider sign-in in scenarios. Recommended: it stays out; the OAuth call site is compiled and snapshotted but no
   scenario drives it. The alternative: build the harness's provider first and move this round after it.
9. One invite, one membership. Recommended: a channel invite does not bring the team; an outsider is invited to
   both and one link accepts both. The alternative: an invite to a membership inside a tenant also joins the tenant
   in its lowest role.
10. The web part. Recommended: the shell brings only the landing page; the pending list and the form are pages and
    sections the model declares. The alternative: a section built into the parent's page, as first drafted.
11. The proof. Recommended: WS-11, WS-12, blog FEAT-14 and a sixth walk, `invite`. The alternative: drop FEAT-14
    and cover the membership without tenancy or role by unit tests alone.
12. The account registered ahead of its owner. Recommended: this round does not close it; the reference says it
    plainly, and verified registration, now in the 1.1 table under `sign-in flow settings`, becomes a round of its
    own before the kits. The alternative: leave it to 1.1, or widen this round with a mark for a proven email, a
    password cleared at the first proof and sessions that can be ended.
