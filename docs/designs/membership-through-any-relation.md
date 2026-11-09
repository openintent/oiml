# Design: membership through any relation

**Status: built 2026-11-09** (round A2 of the road to 1.0.0). What changed from the design below while building:
the grammar is as written; `ranked` on a field that is not an enum is a schema refinement ("ranked only applies to
enum fields") and M039 is two ranked enums on one entity; a reverse relation to any entity that reaches the
identity counts as a membership (the authors of a channel's messages are one, odd but consistent), and M036 fires
when the junction has two relations to the identity and the path did not arrive through it; the resolved
membership sits under the path ending in the relation's name (`channel_id.members`), never the row's own column, so
`member:members` on the channel cannot shadow its `id`; `withRuleValues` and the Go `ruleRow` take the session only
in modules whose rules end in a membership relation, so every other module's output is byte for byte what it was
(the snapshot step showed only the three shared access modules changing); the Go generator kept its own `hasVia`,
which did not know memberships, so its `Get` checked the read rule against a bare row, found by the blog scenario
and not by the walks, whose follow rows are self-follows (a walk limitation worth a later fix: related rows between
actors); the Go list subquery casts the ranked enum to text before `= ANY`. The harness evaluator learned the
predicate (`Resolver.resolve` takes the session). Proof: workspace WS-9 "channels" (Channel, ChannelMember with
`ranked: true`, Message, a `join` row action with an overlay handler on each backend, 39 steps) and blog FEAT-12
"followers and bulletins" (Follow with two identity relations, Bulletin read by the author's followers, 14 steps),
conformance 9/9 with every earlier scenario unchanged (blog 141 and workspace 165 scenario tests per backend) and the
five walks passing (blog 501 rule calls and 760 probes, workspace 473 and 956 with 16 home-team rows checked against
an outsider), 116 unit tests, the oracle gate 27/27 with `fx-ws-9-channels` and `fx-blog-12-followers`, and the
cases `ws2-private-channels` and `empty-playlists` for the next live round. The construct all three clone exercises
named, and the only one none of the generated rounds had, because a ten-line intent rarely has two kinds of
membership at once.

`member:` today means one thing: the caller has a row in the tenancy's membership entity for the tenant the path
reaches. Every application with a second membership shape stops there. Spotify's playlists have collaborators
beside the artist's team; Slack's channels have members beside the workspace's; Notion's pages are shared with
named people at a level beside the workspace and the teamspace. Each is the same shape as tenancy, a junction
between the thing and the identity, sometimes with a ranked role, and each is written today as a handler that no
scenario can read. The construct lets a `member:` path end in any such junction, which makes tenancy the special
case it always was.

## What was asked, in the exercises' words

| Ask                                                                                  | Where                          | Verdict                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------ | --------------------------------------------------------- |
| "Chosen people may edit a playlist with its owner"                                   | Spotify SP-5                   | construct                                                 |
| "Only members read a private channel; anyone in the workspace reads a public one"    | Slack SL-3                     | construct, with a tenant alternative                      |
| "A member of the channel posts, and the message is theirs whatever the request says" | Slack SL-4                     | construct, in a conjunction with an owner binding         |
| "Only the participants read a conversation"                                          | Slack SL-5                     | construct                                                 |
| "A guest sees only the channels they were added to"                                  | Slack SL-1                     | construct: a guest's only rows come through memberships   |
| "A page is shared with named people at a level: full access, edit, comment, view"    | Notion NO-5                    | construct, with a ranked enum on the junction             |
| "Only my followers see my updates"                                                   | blog2-followers (corpus), SP-6 | construct: a junction with two relations to the identity  |
| "A file is downloadable by whoever may read its message"                             | Slack SL-10                    | the file-access gap; this gives it the rule to follow     |
| "A page shared with a group"                                                         | Notion NO-5                    | declined below: a right granted through a second junction |
| "A pending invite is not a membership yet"                                           | the invites design             | declined below: pending rows live in their own entity     |
| "A share link that shows only one owner's board"                                     | r4-09                          | not this: a page filter, the pages gap                    |

## The construct

```yaml
entities:
  Channel:
    fields:
      team_id:
        { type: uuid, required: true, relation: { entity: Team, name: team, reverse: channels, on_delete: cascade } }
      created_by: { type: uuid, required: true, relation: { entity: User, name: creator, on_delete: cascade } }
      name: { type: string, max_length: 80, required: true }
      private: { type: boolean, required: true, default: false }
    unique: [[team_id, name]]
    rules:
      read: "member:members or member:team_id when private = false"
      create: "member:team_id and owner:created_by"
      update: "member:members:admin or member:team_id:admin"
      delete: "member:members:admin or member:team_id:admin"
      hidden: not_found
  ChannelMember:
    fields:
      channel_id:
        {
          type: uuid,
          required: true,
          relation: { entity: Channel, name: channel, reverse: members, on_delete: cascade }
        }
      user_id:
        {
          type: uuid,
          required: true,
          relation: { entity: User, name: user, reverse: channel_memberships, on_delete: cascade }
        }
      role: { type: enum, enum_values: [admin, member], required: true, default: member, ranked: true }
    unique: [[channel_id, user_id]]
    rules:
      read: "member:channel_id.members or member:channel_id.team_id when channel_id.private = false"
      create: "owner:channel_id.created_by or member:channel_id.members:admin"
      delete: "owner:user_id or member:channel_id.members:admin"
  Message:
    fields:
      channel_id:
        {
          type: uuid,
          required: true,
          relation: { entity: Channel, name: channel, reverse: messages, on_delete: cascade }
        }
      author_id: { type: uuid, required: true, relation: { entity: User, name: author, on_delete: cascade } }
      body: { type: text, required: true }
    rules:
      read: "member:channel_id.members or member:channel_id.team_id when channel_id.private = false"
      create: "member:channel_id.members and owner:author_id"
      update: "owner:author_id"
      delete: "owner:author_id or member:channel_id.members:admin"
      hidden: not_found
```

`member:<path>[:<role>]` keeps its spelling. Every segment but the last is a relation field, as today. The last
segment is either a relation to the tenant (today's meaning, which still needs `auth.tenancy`) or, new, a
**membership relation**: a reverse relation, declared with `reverse:` on a junction's relation field, whose entity
has a relation to the identity. The caller is a member when a row of that entity points at the row the path
reaches and at the caller; with `:role`, when that row's ranked enum is at least the value named. So
`member:members` on Channel is the channel's own members, `member:channel_id.members` on Message is the members of
the message's channel, `member:collaborators` on Playlist is its collaborators, `member:shares:edit` on Page is
anyone shared at edit or above. Tenancy's `member:team_id` is the same predicate with the tenant's own membership
relation implied, and `member:id` on the tenant entity stays.

- **The member column.** The membership entity's relation to the identity. When the membership relation itself
  points at the identity, as `followers` does on a `Follow` row (`followee_id` with `reverse: followers`), the
  member column is its other relation to the identity (`follower_id`), so `member:author_id.followers` on a row
  with an author means "the caller follows the author". A membership entity with no relation to the identity, or
  two candidates once the arriving relation is set aside, is refused.
- **Ranked enums.** `ranked: true` on one enum field of the membership entity says its values rank in the order
  declared, first most privileged, as tenancy's `role_field` does by its declaration. `:role` needs it and names
  one of its values. Without a ranked enum, membership is all or nothing.
- **Where it applies.** The four rules, an action's rule, and `hidden`. Lists show only rows the caller is a
  member of (or that another alternative allows); get, update, delete and row actions check the row; on create the
  client sends the relation field the path starts with (or the row's own id is the target when the path is one
  segment) and the related row is checked, so `and owner:author_id` binds the author while the membership is
  tested on the channel the body names. `when` on the predicate conditions the row as it does today.
- **Statuses.** Unchanged from `member:`: 401 without a session, 403 for a caller who is not a member or whose
  role is below the one named, 404 for a hidden row under `hidden: not_found`, and on create 403 when the related
  row the body names is missing or the caller is not in its junction, as the related-row check answers today.

| Caller and rule                                             | Answer                                    |
| ----------------------------------------------------------- | ----------------------------------------- |
| Anonymous, any membership rule and no public alternative    | 401, before the row is loaded             |
| Signed in, not in the junction for the row the path reaches | 403, or 404 under `hidden: not_found`     |
| In the junction below the role named                        | 403 (the row is visible when read allows) |
| In the junction at or above the role                        | allowed                                   |
| A list                                                      | rows whose junction holds the caller      |
| Create naming a channel the caller is not a member of       | 403                                       |

Decisions, and why:

- **One predicate, not a new one.** The exercise notes sketched `in:collaborators`. `member:` already means "has a
  membership row for the thing the path reaches", and agents already write it with paths; one sentence in the
  reference widens it, where a second predicate would need its own sentence and its own place in every grader
  pattern. Tenancy becomes the case where the junction is implied.
- **The junction declares itself.** No `memberships:` block on the entity to keep in sync: a membership relation
  is any reverse relation whose entity reaches the identity, and the rule names what the model already declares.
  The reverse name is the one the entity's `include` uses, so `include: [members]` and `member:members` read the
  same word.
- **`ranked` on the enum, not a key on the relation.** The rank is a property of the enum's order, which is the
  sentence the reference has for tenancy already. One ranked enum per entity; a junction with a `status` enum
  beside its `role` says which one ranks.
- **Lists compile to a subquery through the junction; rows to one lookup.** The session carries the tenancy's
  memberships because a tenant list is short and every resource reads it. A junction's targets can be large
  (everyone the caller follows) and few resources need them, so a list filter is `EXISTS` through the junction, the
  shape paths already compile to, and a row check resolves the one membership row for the row's target the way
  `withRuleValues` and `ruleRow` resolve path values today. `verdict` stays a pure function of the session and the
  row it is given.
- **Who adds the first member.** No creator role outside tenancy. The creator of the parent adds themselves
  through an owner path, `create: "owner:channel_id.created_by or member:channel_id.members:admin"`, which the
  reference shows; a channel without a creator field uses an event handler, as today.

## Mapping

- Model: the predicate regex is unchanged (`member:<path>[:<role>]`). `Field.ranked?: true`, enum only. In the
  member branch of rule validation, when the last segment is not a field of the entity reached, look for a reverse
  relation of that name there and check its entity as described. M024 reworded: "member rules need auth; a tenant
  field also needs auth.tenancy". M025 reworded: "member field X must be a relation to Team, the tenant's own
  primary key, or a membership relation (a reverse relation to an entity with a relation to User)". M026 unchanged
  for tenancy. New: M036, the reverse relation's entity is not a membership (no relation to the identity, or two
  candidates), naming the candidates; M037, `:role` on a membership without a ranked enum, or a value it lacks
  ("mark ChannelMember.role ranked: true to use member:...:admin"); M038, a warning, the membership entity has no
  unique on its target and member columns; M039, `ranked` on a field that is not an enum, or two ranked enums in
  one entity. `canHideRows` already counts member rules as row-dependent, so M035 needs nothing.
- IR: the `member` predicate gains `through?: MembershipIR` (`entity`, `table`, `targetColumn`, `memberColumn`,
  `roleColumn?`, `roles?`); `field` is then the primary key of the entity the hops reach, and `via` the hops as
  today. `ruleKey` is unchanged, so `ruleValuesSource` and `rulePaths` list the predicate with the paths and the
  hidden-row check shares its resolution. `auth.tenancy` and tenancy's member rules are untouched, so every proven
  output stays byte-identical.
- drizzle-next and hono-trpc-vite (shared in `@osl/ts-common`): `withRuleValues` resolves, beside path values, one
  lookup per `through` predicate: the actor's row in the junction for the resolved target, stored under the
  predicate's key as its ranked value (or `true` without one, `null` when absent). `verdict`'s member branch tests
  that value's rank when the rule has `through`; `rank` takes the roles from the rule rather than the tenancy's
  list. `listRuleFilter`'s leaf for a `through` predicate becomes `inArray(t.<pk>, db.select({ id: j.<target>
}).from(j).where(and(eq(j.<member>, me), inArray(j.<role>, rolesAtLeast))))` through the existing `through()`
  hops, with no `tenants` guard. `createChecksBody` is already true for member. Pages: `rulePredicate` already
  renders a member rule as `user !== null` and leaves the decision to the API.
- gin-pgx: `ruleRow` adds the lookup under the same key; `access.CheckRow` reads it for `through` rules with the
  rule's roles; the list builder emits the junction subquery with `where.Raw` and `goConcat`, as paths do.
- OpenAPI: the rule sentence names the junction: "a member of the channel (ChannelMember), at least admin".
- Diff: `set_rules`, `add_field` and `update_field` carry everything; `rename_entity` already rewrites rules.
  Changing a junction's `reverse` name through `update_field` orphans the rule, which M025 then reports.
- Grader: `normalizeRule` is textual; case expectations name the rule text. Clusterer: a topic "membership through
  any relation" (collaborator, co-editor, shared with, participants only, members of a channel or group, private
  channel, added to a group) so rounds file their lines under the backlog key.
- Reference: under Entity, after the member sentence: "`member:` may also end in a membership relation: a reverse
  relation whose entity has a relation to the identity (`member:members` on Channel, `member:channel_id.members`
  on Message, `member:author_id.followers` on a row with an author). The caller is a member when a row of that
  entity points at the row reached and at them; `member:shares:edit` needs an enum marked `ranked: true` on the
  membership entity and allows that value or a higher one. Choose it when the ask shares or adds people to one
  row (a playlist, a channel, a page); choose tenancy when every row of the app belongs to a team." `docs/model.md`
  regenerated; `docs/backends.md` rules row extended.
- The three exercise notes: the `in:` sketches become `member:`.

## Declined, with the sentence the reference gets

- A right granted through a second junction (a page shared with a team, read by the team's members): "a
  membership relation ends a path; a share granted to a group is not expressible: say so in not_delivered".
- `when` on the junction's own fields (a pending or expired membership): "a membership counts as soon as its row
  exists; keep pending invites in their own entity", which the invites design does.
- A creator role outside tenancy: "whoever creates the parent adds themselves: `owner:channel_id.created_by`".
- Ranking across two junctions (a workspace admin outranking a channel member): alternatives already say it,
  `member:channel_id.members:admin or member:channel_id.team_id:admin`.
- Rules inherited down a tree (a page without shares taking its parent's): the backlog's own entry.
- Counting members: `count_of`, in the archive-and-counts design.
- Preloading junction memberships on the session for speed: lists are subqueries and rows one lookup; a
  measured need decides later, not this note.

## Proof

- Fixtures: workspace WS-9 "channels" adds the three entities above, resources `channels` (with a `join` row
  action under `member:team_id when private = false`, whose overlay handler on each backend inserts the caller's
  membership and answers 409 when it exists), `channel_members` and `messages`, and a scenario in which Alice
  creates a private channel (201, `created_by` bound), adds herself as admin (201, through the owner path), adds
  Bob (201); Carol, a member of the team, lists channels without it, gets it (404), posts in it (403); Bob posts
  (201, `author_id` his whatever the body says), lists messages (200), deletes Alice's message (403); Alice deletes
  Bob's (204); Bob adds Dave (403); Alice adds Dave as admin (201); Dave removes Bob (204), after which Bob's get
  is 404; an anonymous list is 401. Then a public channel: Carol lists and reads its messages without membership
  (200), posts (403), joins (200), posts (201), and a member of another team gets the channel (404). Blog FEAT-12
  "followers and bulletins" adds `Follow` (`follower_id` → User with `reverse: following`, `followee_id` → User
  with `reverse: followers`, unique on both, `create` and `delete` as `owner:follower_id`) and `Bulletin`
  (`author_id`, `body`) with `read: "owner:author_id or member:author_id.followers"` and `create:
"owner:author_id"`, and a scenario in which Bob follows Alice (201), again (409), reads her bulletin (200),
  Carol reads it (403) and lists none, Bob unfollows (204) and is refused (403). The second fixture proves the
  two-identity junction and a path that ends on the identity's own membership relation, without tenancy.
- Eval cases: `fx-ws-9-channels` and `fx-blog-12-followers` with the fixtures' diffs as oracles; `ws2-private-
channels`, the Slack ask over the workspace base through WS-2, expecting `member:` with `members` in Message's
  rules and 403 and 404 in the scenarios; `empty-playlists`, the Spotify ask over an empty model, expecting a
  collaborators junction and `member:collaborators` on the playlist's update rule.
- Gate: conformance 9/9, snapshots, the oracle grader, rounds 1 to 7 graded again with `--resume` losing nothing,
  a fresh round with the new topic no longer reporting it; then `built` in the backlog, and the three exercise
  notes' verdicts revised.

## Size

Core: the `ranked` key, the resolution branch, `through` in the IR, four diagnostics and two rewordings, the
reference. In `@osl/ts-common`: the lookup in `withRuleValues`, the verdict branch, the filter leaf. The same three
in Go. Two fixtures with one overlay handler, four eval cases, snapshots. About the relations round.
