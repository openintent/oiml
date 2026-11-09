# Design: invites

**Status: proposed 2026-11-09.** Not yet built. The top open gap of the backlog since round 6, and the construct
the SaaS asks keep stopping at. The grammar below is the design to review before the build.

Both hand-written applications surveyed for these notes have the same invite: a row with an email, a role and a
hashed token that expires, a link that proves the email the way a magic link does, and three ways in for the
invitee. One of them wrote the acceptance three times, once per sign-in path, and the copies drifted. The shape
below is what they converged on, declared once.

## What was asked, in the agents' words

| Ask                                                                                                                                                                         | Where                                   | Verdict                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------- |
| "Owners and admins invite people to a team by email. The invitee gets a link; accepting it makes them a member. Pending invitations are listed per team and can be revoked" | `ws1-invites-gap` (corpus, outcome any) | construct, every clause                                 |
| "Create a publication, invite others, and give each person a role: owner, editor or writer"                                                                                 | `gen-r1-02-publication-editorial-teams` | construct: the role on the invite                       |
| "Each club gets its own private space with members, moderators, and an owner. People can join several clubs"                                                                | `gen-r7-10-club-forums`                 | construct: joining is accepting                         |
| "Needs an invitation that an account not yet registered can accept"                                                                                                         | the backlog note, run 6                 | construct: the link creates the account                 |
| A guided first-run wizard after joining                                                                                                                                     | hand-written applications               | a custom page; not a construct                          |
| Seat limits on the plan                                                                                                                                                     | hand-written applications               | a handler on the `teams.invite` event; billing declined |

## The construct

```yaml
auth:
  tenancy:
    entity: Team
    membership: TeamMember
    role_field: role
    creator_role: owner
    invites: { rule: "member:id:admin", expires: 7d } # who may invite to a team; default rule member:id:<creator_role>, default 7d
```

`invites` adds, without declaring them in the model file, the same way `password_hash` arrives with credentials:

- **The entity.** `<Tenant>Invite` (`TeamInvite`): `team_id` → Team (cascade), `email` (string), `role` (the
  membership's role enum), `invited_by` → the identity, `token_hash` (hidden), `status` (read_only enum: pending,
  accepted, revoked), `expires_at` (read_only datetime), `created_at`. Unique on `(team_id, email)` while pending.
- **Operations on the tenant resource** (`teams` here), as row actions named by the compiler; a declared action of
  the same name is an error: `POST /api/teams/{id}/invites` { email, role } under the invites rule, 201 with the
  invite (never the token) after sending the mail through the email adapter with `/invite/{token}`; `GET
/api/teams/{id}/invites` lists pending ones under the same rule; `DELETE /api/teams/{id}/invites/{invite_id}`
  revokes. The role granted may not outrank the inviter's own role in that team (403), an existing member is a 409,
  and the creator role is the ceiling nobody below it can grant.
- **The invitee's side**, under `/api/auth`: `GET /api/auth/invites/{token}` (public) answers the team's display,
  the role and a masked email for the landing page; `POST /api/auth/invites/{token}/accept` creates the membership.
  With a session, the session's email must match the invite's, case-insensitive (403 otherwise). Without one, when
  the identity needs nothing but email and name the user is created and signed in, the invite link having proved
  the email as a magic link does; otherwise 401, and the invite is accepted on the next sign-in. A revoked or
  unknown token is 404, an expired one 410, both the same body.
- **Auto-accept.** Every way in (register, login, magic-link verify, OAuth callback) accepts the caller's pending,
  unexpired invites by email. One place, called from four.
- **Scenarios.** Steps `teams.invite` { email, role }, `teams.invites`, `teams.revoke_invite`, `auth.invite`
  { token } and `auth.invite_accept` { token }. Under the test hooks the invite reply carries `data.debug.token`,
  as the magic link does, and `emails.sent` shows the mail.
- **The web app.** The tenant resource page's detail pane gains an Invites section (email, role, send; the pending
  list with revoke) when the viewer passes the rule, and `/invite/{token}` shows the landing with Accept, sending a
  signed-out visitor to sign in or register with the token kept. API-only backends ignore this.

## Mapping

- Core: `Tenancy.invites?: { rule?: Rule, expires?: Duration }`; the IR adds the invite entity, its routes under the
  tenant resource and under auth, and the rank check as a resolved rule. Diagnostics: `invites` without a tenant
  resource (nowhere to hang the routes), a declared action named `invite`, `invites` or `revoke_invite` on it, an
  identity entity whose required fields beyond email and name make the create-on-accept path impossible (a warning:
  "invitees must register first").
- drizzle-next and hono-trpc-vite: the invite module beside the auth routes, reusing the magic-link token hashing,
  the session creation and the email adapter; the accept-pending helper called from the four sign-in paths.
- gin-pgx: the same module in Go, the same four call sites.
- OpenAPI: the routes with their statuses; `docs/model.md` gains the paragraph above under Auth.
- Diff: `set_auth` carries the key, as every tenancy key does.

## Declined, with the sentence the reference gets

- A join link not bound to an email ("anyone with this link may join"): a different construct; "an invite names one
  email".
- Changing a member's role, removing a member: the membership resource already exists; the backlog has "role
  changes" as its own gap.
- Onboarding wizards and first-run steps: "a custom page, after the invite".
- Seat limits and plans: a handler on the `teams.invite` event; billing is declined by design.

## Proof

- Fixture: workspace WS-10 "invite a colleague": the owner invites a registered user as member (201), a member
  tries to invite (403), the owner tries to invite as owner (403), the invitee accepts with the captured token
  (201; `auth.me` then lists the membership), a second accept is 409, the owner invites an unknown email and the
  anonymous accept creates the account and a session (201), a wrong signed-in user accepts someone else's invite
  (403), a revoked invite answers 404, `emails.sent` shows two mails with the team's name in the subject. Expiry is
  a unit test on the module (the scenario clock does not move the server's clock for accept).
- Eval cases: `fx-ws-10-invites` with the fixture's diff as oracle, and the r6 workspace-invites ask promoted as a
  case expecting `invites` under tenancy and 403 and 201 in the scenarios.
- Gate: conformance 9/9, snapshots, rounds graded again with `--resume` losing nothing, a fresh round no longer
  reporting "invites and onboarding"; then `built` in the backlog.

## Size

Core: the key, the compiler-added entity and routes in the IR, three diagnostics, the reference. One module per
backend plus four call sites, the web section and the landing route in the two web backends, five scenario ops in
the harness. About the size of the hidden-rows round plus the web work.
