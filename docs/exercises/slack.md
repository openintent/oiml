# Exercise: a Slack clone

**Status: assessed 2026-11-09.** The second clone exercise, by the method in `spotify.md`. Nothing here is built;
the sketches are starting points for design notes, not grammar.

Slack is the workspace fixture's shape (a tenant, memberships with ranked roles, rows that reach the tenant through
relations) with one more layer: channels, each with its own membership, and everything a person may see or write
decided by that second membership. Spotify found the same predicate missing once, for collaborative playlists;
Slack needs it in four intents. Its screen is a chat log, which is not a master-detail page and is not read by
page number.

## The intent series

Verdicts: **yes** means the intent lands as a diff today; **partial** means the data lands and a named piece does
not; **out** means the model does not express it, with the reason.

| Intent                             | Ask, in one sentence                                                                                                                                                                                                       | Verdict                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SL-1 Accounts and workspaces       | People sign up with a password, Google or a magic link, create workspaces, and the creator owns one; owners and admins run it, members use it, guests see only what they are added to.                                     | yes: Workspace as the tenancy entity, WorkspaceMember with owner, admin, member and guest; the guest's narrowing is SL-3's gap                                                                                                                                                                                   |
| SL-2 Invites                       | An admin invites people by email with a role; someone without an account accepts and lands in the workspace; a workspace may also share a link anyone can use to join.                                                     | partial: email invites are designed (`designs/invites.md`, open); a link not bound to an email is declined there                                                                                                                                                                                                 |
| SL-3 Channels                      | Channels are public or private, unique by name in a workspace, with a topic and purpose; any member joins a public channel, a private one only by being added by someone already in it; channels can be archived.          | partial: Channel and ChannelMember land; joining a public channel is `member:channel_id.workspace_id when channel_id.private = false and owner:user_id` today; reading or being added to a private one is `member:members` and `member:channel_id.members:admin` since round A2; archive is designed             |
| SL-4 Messages and threads          | A member of a channel posts messages with text and attachments; replies form a thread under a parent; authors edit their own messages for fifteen minutes and delete them; admins delete any.                              | partial: Message with a self-relation `parent_id` (the subtasks eval case proves self-relations), `owner:author_id or member:channel_id.workspace_id:admin` for delete; "may post" and "may read" are `member:channel_id.members` since round A2; "for fifteen minutes" compares against now, which no rule does |
| SL-5 Direct messages               | A person opens a conversation with one or more people; only the participants read it; opening the same conversation again finds the existing one.                                                                          | partial: a Channel of kind `dm`; find-or-create is a collection action with a handler; participants-only reading is `member:members` since round A2                                                                                                                                                              |
| SL-6 Reactions, pins and saves     | A member reacts to a message with an emoji once per emoji, pins a message in a channel, and saves a message for themselves.                                                                                                | yes: three junction entities, `unique: [[message_id, user_id, emoji]]`, owner rules; the count per emoji is grouped and comes from the client reading the list                                                                                                                                                   |
| SL-7 Mentions and notifications    | Naming a person, a group or the channel in a message notifies them; people see their notifications and mark them read; groups like engineering expand to their members.                                                    | yes by design: an event handler on `Message.created` parses the text and writes Notification rows under owner rules; UserGroup and its members are a junction; a digest is a schedule                                                                                                                            |
| SL-8 Unread state                  | Each channel shows how many messages the viewer has not read and goes bold; opening it marks it read; an all-unreads view lists them.                                                                                      | out: the marker (ChannelRead with `last_read_at`, an upsert action) lands; the count of messages newer than the viewer's own marker is a per-viewer aggregate no field or tile can hold                                                                                                                          |
| SL-9 Search                        | One box finds messages across every channel the person can see, with people and files, ranked by relevance and filtered by channel, sender and date range.                                                                 | partial: `search:` is a substring per resource under the read rule; across resources is recorded; ranking is full-text; a date range is a comparison, not an equality filter                                                                                                                                     |
| SL-10 Files                        | Files uploaded into a channel or conversation are downloadable only by the people who can see the message, and a workspace lists its files.                                                                                | partial: the file field lands; a file's read rule following its message's rule is the per-field file access gap                                                                                                                                                                                                  |
| SL-11 Presence and live messages   | New messages appear as they arrive, people show as online or away with a status text and emoji, and typing shows.                                                                                                          | out: realtime is declined; status fields land; `refresh` polls a channel                                                                                                                                                                                                                                         |
| SL-12 The channel screen           | A sidebar lists the current workspace's channels and conversations, a channel page sits at its own address with the newest messages at the bottom, older ones loading on scroll, and a composer; people switch workspaces. | out: pages with parameters is recorded, and Slack adds the tenant context that scopes the whole sidebar; the chat layout is a custom page; lists are read by page number with a total, where a log wants an anchor on a message                                                                                  |
| SL-13 Reminders and scheduled send | A person asks to be reminded about a message at a time, and schedules a message to send later.                                                                                                                             | yes: Reminder with a timer on `at`; Message with `send_at`, a `scheduled` status and a timer `when status = scheduled` (the FEAT-9 pattern)                                                                                                                                                                      |
| SL-14 Administration               | Owners change roles but nobody below owner grants owner, deactivate accounts, delete channels, export the workspace, and read an audit log.                                                                                | partial: deactivation is the banning pattern; deleting is delete; the role ceiling is the open `role changes` gap; audit is designed; export is a handler                                                                                                                                                        |
| SL-15 Apps and bots                | Incoming webhooks post into a channel, outgoing webhooks fire on message events, bots act with a token, slash commands call out.                                                                                           | partial by design: outgoing webhooks and bot tokens are designed (`audit-and-webhooks.md`, `agent-surface.md`); incoming webhooks and slash commands are custom routes in `src/`                                                                                                                                 |
| SL-16 Workspace settings and emoji | Admins upload custom emoji and set who may create channels and how long messages are kept.                                                                                                                                 | yes: Emoji with a file; "who may create channels" is `member:workspace_id:admin or member:workspace_id when workspace_id.members_create_channels = true` (a condition through a relation); retention is a schedule whose handler compares with `ctx.now`                                                         |

Five intents land, eight are partial, three are out. The partials share two causes: one missing predicate under
SL-3, SL-4, SL-5 and SL-10, and comparisons against time under SL-4, SL-8 and SL-9. The data model otherwise fits
the workspace fixture so well that the proof belongs there, not in a new fixture.

## The gaps, ranked by how much of the app they block

1. **Membership through any relation** (backlog `membership through any relation`, recorded by the Spotify
   exercise). Blocks the private side of SL-3, SL-4, SL-5 and SL-10: who may read a private channel, post in a
   channel, read a conversation, download its files. Slack adds two requirements to the sketch: the predicate
   must take a path (`in:channel_id.members` on Message reaches the channel's junction), and it must sit in a
   conjunction with an owner binding (`in:channel_id.members and owner:author_id`) the way `member:` does today.
   The mapping stays the EXISTS subquery `member:` compiles to, with the identity column read from the junction's
   relation to the identity. With it, a guest is a workspace member whose channels are the only rows they reach. Design:
   `../designs/membership-through-any-relation.md` (`member:channel_id.members`). Built in round A2 (2026-11-09) and
   proven on the workspace fixture's channels (WS-9).
2. **Pages with parameters, with a tenant context** (backlog `pages with parameters`). Blocks SL-12. Slack is
   lived inside one workspace at a time: the sidebar, every list and every page carry the chosen workspace. The
   rounds already file this ask under the same topic ("one board per team", "scoped to a team"). Sketch: a
   `{tenant.id}` template beside `{actor.id}`, a route prefix the app chooses the tenant under, and a switcher in
   the shell. The chat layout itself stays a custom page.
3. **Cursor pagination** (new, `cursor pagination`). Blocks the message list in SL-12 and matters for every
   large table. Lists answer `page` numbers and a `total`, which is a count per request; a log wants
   `before: <id>` and `after: <id>` anchored on the order columns, newest first, with no count. Sketch:
   `list: { paging: cursor }`, allowed when the order ends in a unique column, answering `{ data, page: { next,
prev } }`; the mapping is a keyset WHERE on all three backends. The resource page's list loads older rows
   on scroll.
4. **Conditions against now** (new, `conditions against now`). Blocks the edit window in SL-4 and the date range
   in SL-9; the reference today says to decline "due before today" and "upcoming". Sketch: `when created_at >
now-15m` on any predicate, and a range filter on lists spelled the same way scenarios spell time; row checks
   compare with `ctx.now`, lists with the request clock. Deterministic and small: the rules' side of what timers
   already do.
5. **Per-viewer aggregates** (backlog `computed and aggregate fields`). Blocks SL-8. An unread count compares a
   channel's messages with the viewer's own marker; a reaction count per emoji groups a relation. Neither is
   `count_of`, which counts one relation per row. Likely declined with a sentence: "a count that depends on who
   is looking is a custom page or an action".
6. **Search and ranking** (new entry on the existing topic `search and ranking`). Blocks the ranking in SL-9.
   Sketch: `search: { fields: [body], mode: full_text }` as a `tsvector` column with a GIN index and `ts_rank`
   ordering; SQL on all three backends. Substring search stays the default.
7. **Role changes** (backlog `role changes`, open since r4). Nobody below owner grants owner (SL-14); the same
   "what a client may write depends on who they are" the field-visibility design declines.
8. Already recorded or designed: file access per field (SL-10), invites (SL-2), archive (SL-3), audit and
   webhooks (SL-14, SL-15), API keys (SL-15).

## Out by design, and still right

- Realtime: live messages, presence, typing. `refresh` polls.
- Mention parsing and notification fan-out: an event handler; the model declares the rows it writes.
- Incoming webhooks and slash commands: custom routes; the model describes this app's API.
- Export: a handler or a custom route; no round has asked twice.
- Link invites: declined in the invites design; an invite names one email.

## Bake order

Membership through any relation moves to the front: Spotify needed it once, Slack needs it four times, and the
workspace fixture already has the tenant it composes with. Cursor pagination and conditions against now are each
small and can ride with the pages round. Search and ranking waits for a round to ask.

## The fixture it implies

Not a new one: the workspace fixture gains channels. WS-9 channels and private membership (SL-3, the proof of
membership through any relation, including a guest who sees one channel), WS-10 messages, threads and the edit
window (SL-4, SL-5, the proof of conditions against now), WS-11 a channel page with a cursor (SL-12, the proof of
cursor pagination and the tenant context). Reactions and reminders are already proven patterns and need no
fixture of their own.
