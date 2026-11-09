# Design: API keys and the agent surface

**Status: proposed 2026-11-09.** Not yet built. The grammar below is the design to review before the build.

Every generated app has an API with validation, rules and an OpenAPI document. Hand-written applications of this
shape then build the same API a second time for agents: one of the two surveyed for these notes wraps fifty-nine
service calls as MCP tools by hand across twenty-eight files, keeps a separate SDK copy honest with a parity test,
and grants tools through a hand-kept rules table; the other runs an agent hub whose spokes expose each app's
actions through signed, audience-scoped tokens with approval grants for writes. Both issue API keys with scopes and
make every mutating request idempotent. OSL has the resources and actions with their rules, so the second API is a
pure function of the first. This is the construct that makes "built with OSL" mean "operable by an agent".

## What was asked

No round has asked for this: the generated intents describe an application's own users, never a program or an
assistant calling it, and the corpus has no API-key case. The asks below are the ones the hand-written
applications met once they had partners and agents.

| Ask                                                                   | Verdict                     |
| --------------------------------------------------------------------- | --------------------------- |
| A partner integrating with a key instead of a browser session         | construct: `api_keys`       |
| Keys that may only read                                               | construct: scopes           |
| A retried create that must not create twice                           | construct: idempotency keys |
| An assistant that lists and updates what the user may list and update | construct: `mcp`            |
| Rate limits per key                                                   | declined below              |

The generated rounds should start asking: the round generator can be told that some intents have a program or an
assistant as the caller, which is the cheapest way to find out whether agents reach for these constructs.

## 1. API keys

```yaml
auth:
  identity: User
  providers: [credentials]
  api_keys: true
```

- A compiler-added `ApiKey` (`user_id` → identity, `name`, `prefix`, `key_hash` hidden, `scopes` array of string,
  `last_used_at` read*only, `revoked_at` read_only) and routes `POST /api/auth/api-keys` { name, scopes } answering
  the key once as `osl*<prefix>\_<secret>`, `GET /api/auth/api-keys`, `DELETE /api/auth/api-keys/{id}`; a user
manages their own keys, and `auth.me` lists them without secrets.
- `Authorization: Bearer osl_...` resolves to the key's user as the session, with the key's scopes. Every rule
  applies unchanged, so a key can do what its user can do, narrowed by scopes: `<resource>:read`,
  `<resource>:write` (create, update, delete, actions and transitions), `actions:<name>` for a global action, `*`.
  A call outside the key's scopes answers 403 with code `scope`.
- `Idempotency-Key` on create, actions and transitions with a key: the first response is stored for 24 hours per
  key and replayed for the same key and header, with `409` and code `idempotency_mismatch` when the body differs.
  A compiler-added table holds them; a schedule the compiler adds purges them.
- OpenAPI: a `bearer` security scheme beside the cookie, scopes listed per operation, the header documented.
- Scenarios: `auth.api_key` { name, scopes } captures the key, and a step may say `key: "{key}"` instead of `as:`
  to send it.

## 2. The MCP surface

```yaml
mcp: true
```

`POST /mcp` (streamable HTTP) on the same server, authenticated by API key, serving one tool per operation the
model declares, with the key's scopes as the grant:

- `<resource>_list` with the list's filters, sort, search and page as arguments; `<resource>_get`, `_create`,
  `_update`, `_delete` with the operation's fields; `<resource>_<action>` and `actions_<name>` with the action's
  input; transitions, archive and restore as the actions they are. Descriptions come from the entity's and fields'
  `description`, the rule in one sentence, and the statuses; input schemas are the same validation the API uses;
  results are the API's JSON as text, errors the API's error object.
- One `osl_model` tool answers the reference's view of the model (entities, fields, resources, actions, rules), so
  an agent reads what it may do before trying.
- Rules apply exactly as for the API: the key's user is the session. There is no second grant table; scopes narrow,
  rules decide.
- Under the test hooks, the harness calls tools through a step `mcp.call { tool, arguments }` with a captured key.

## Mapping

- Core: `Auth.api_keys?: true`, top-level `mcp?: true` (needs `api_keys`; diagnostic otherwise); the IR adds the
  key entity, its routes, the scope strings per operation, the idempotency table, and a `tools` list derived from
  the resources and actions with names, descriptions and input schemas. Diagnostics: `mcp` without `api_keys`, a
  tool name collision (two resources whose names differ only by case), a declared entity named like the
  compiler-added one.
- drizzle-next and hono-trpc-vite: the bearer resolver beside the cookie session, the scope check in the resource
  modules (one line per operation, from the IR), the idempotency middleware on the mutating routes, the key routes;
  the MCP server from `@modelcontextprotocol/sdk` under the route handler (Next.js) or mounted on Hono, with tools
  generated from the IR and calling the same resource functions the routes call. The web app's settings page gains
  API keys (create, copy once, revoke).
- gin-pgx: the same resolver, check, middleware and routes; the MCP server from the Go SDK mounted on Gin.
- Reference: a paragraph under Auth and one top-level section, with the rules for choosing: a program that calls
  the API is a key; an assistant is `mcp`; neither widens a rule.

## Declined, with the sentence the reference gets

- Rate limits per key: "limits are the deployment's, not the model's"; the backlog keeps "rate limits and quotas".
- OAuth for MCP clients, and keys for anonymous callers: keys belong to users; "an assistant acts as the user whose
  key it holds".
- An approval step before writes: scopes are the grant; an app that wants a human in the loop gives the assistant a
  read scope and a transition the human runs.
- MCP prompts and resources: tools only; the model is the prompt.
- A generated SDK per language from the OpenAPI document: deterministic, useful, and a round of its own.

## Proof

- Fixtures: todo TODO-9 "assistant and keys": `api_keys` and `mcp`; a scenario that creates a read-only key,
  lists tasks with it (200), creates with it (403 `scope`), creates a write key, creates a task with it twice
  under one `Idempotency-Key` (201 then the same 201 and one row), a different body under the same key (409),
  revokes the key (the next call is 401), and `mcp.call tasks_list` and `tasks_create` with a write key, the
  latter refused by the rule for another user's project (403 through the tool's error). Blog FEAT-16 "API access"
  does the same over posts with the magic-link identity, proving keys without credentials.
- Eval cases: `fx-todo-9-assistant`, `fx-blog-16-api-access`, and the r6 assistant ask promoted.
- Gate: as every round, then `built` for "api keys and agent tools".

## Size

Core: two keys, the compiler-added entity and table, the scopes and tools in the IR, three diagnostics, the
reference. Per backend: a resolver, a middleware, the key routes, the scope lines, the MCP mount with generated
tools; the settings page in the two web backends; the `key:` and `mcp.call` steps in the harness. The largest of
these notes, about the pages round; keys can ship before `mcp`.
