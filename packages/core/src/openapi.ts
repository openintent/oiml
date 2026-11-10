/**
 * An OpenAPI 3.1 document for the REST contract, as a pure function of the IR. Backends that speak REST
 * write it to generated/openapi.json and serve it at /api/openapi.json; the document is the same for all.
 */
import {
  ruleKey,
  type ActionIR,
  type ColumnIR,
  type EntityIR,
  type IR,
  type OperationIR,
  type ResourceIR,
  conditionText
} from "./ir.js";
import { toTitleCase } from "./naming.js";
import type { DiffOp } from "./diff.js";

type Schema = Record<string, unknown>;

const ERROR_SCHEMA: Schema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" }, details: {} }
    }
  }
};

const FILE_SCHEMA: Schema = {
  type: "object",
  description: "An uploaded file: its metadata and a URL that serves it",
  required: ["id", "name", "size", "type", "url"],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    size: { type: "integer" },
    type: { type: "string" },
    url: { type: "string" }
  }
};

function columnSchema(column: ColumnIR, ir: IR): Schema {
  let schema: Schema;
  const t = column.type;
  if (t.kind === "enum") {
    schema = { type: "string", enum: column.enumValues ?? ir.enums.find(e => e.name === t.name)?.values ?? [] };
  } else if (t.kind === "array") {
    schema = { type: "array", items: scalarSchema(t.of) };
  } else if (t.kind === "file") {
    schema = { $ref: "#/components/schemas/File" };
  } else {
    schema = scalarSchema(t.scalar);
    if (t.scalar === "string" && column.maxLength) schema.maxLength = column.maxLength;
  }
  const v = column.validate;
  if (v) {
    if (v.format === "email") schema.format = "email";
    if (v.format === "url") schema.format = "uri";
    if (v.format === "uuid") schema.format = "uuid";
    if (v.min_length !== undefined) schema.minLength = v.min_length;
    if (v.max_length !== undefined) schema.maxLength = v.max_length;
    if (v.pattern) schema.pattern = v.pattern;
    if (v.min !== undefined) schema.minimum = v.min;
    if (v.max !== undefined) schema.maximum = v.max;
  }
  if (column.description) schema.description = column.description;
  if (column.nullable) return { oneOf: [schema, { type: "null" }] };
  return schema;
}

function scalarSchema(scalar: string): Schema {
  switch (scalar) {
    case "string":
    case "text":
      return { type: "string" };
    case "integer":
    case "bigint":
      return { type: "integer" };
    case "float":
      return { type: "number" };
    case "decimal":
      return { type: "string", description: "A decimal number as a string" };
    case "boolean":
      return { type: "boolean" };
    case "datetime":
      return { type: "string", format: "date-time" };
    case "date":
      return { type: "string", format: "date" };
    case "time":
      return { type: "string", format: "time" };
    case "uuid":
      return { type: "string", format: "uuid" };
    case "json":
      return {};
    default:
      return { type: "string" };
  }
}

function presentedSchema(entity: EntityIR, ir: IR, include: string[] = []): Schema {
  const properties: Record<string, Schema> = {};
  for (const c of entity.columns) {
    if (c.hidden || (c.type.kind === "scalar" && c.type.scalar === "bytes")) continue;
    properties[c.name] = c.readOnly ? { ...columnSchema(c, ir), readOnly: true } : columnSchema(c, ir);
  }
  for (const name of include) {
    const rel = entity.relations.find(r => r.name === name);
    if (!rel) continue;
    const ref = { $ref: `#/components/schemas/${rel.target}` };
    properties[name] = rel.kind === "many" ? { type: "array", items: ref } : { oneOf: [ref, { type: "null" }] };
  }
  return { type: "object", properties, required: Object.keys(properties) };
}

function inputSchema(entity: EntityIR, fields: string[], ir: IR, mode: "create" | "update"): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const name of fields) {
    const c = entity.columns.find(col => col.name === name)!;
    properties[name] =
      c.type.kind === "file"
        ? { type: "string", format: "uuid", description: "A file id from POST /api/files" }
        : columnSchema(c, ir);
    if (mode === "create" && !c.nullable && c.default === undefined && !c.generated) required.push(name);
  }
  const schema: Schema = { type: "object", properties, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

function fieldsSchema(fields: ColumnIR[], ir: IR): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const c of fields) {
    properties[c.name] = columnSchema(c, ir);
    if (!c.nullable && c.default === undefined) required.push(c.name);
  }
  const schema: Schema = { type: "object", properties, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

function data(schema: Schema, extra: Record<string, Schema> = {}): Schema {
  return {
    "application/json": {
      schema: { type: "object", required: ["data", ...Object.keys(extra)], properties: { data: schema, ...extra } }
    }
  };
}

const ERROR_RESPONSES: Record<string, Schema> = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "404": { $ref: "#/components/responses/NotFound" },
  "409": { $ref: "#/components/responses/Conflict" }
};

function responses(ok: Schema, status = "200", description = "OK"): Record<string, Schema> {
  return { [status]: { description, content: ok }, ...ERROR_RESPONSES };
}

function openapiPath(path: string): string {
  return path;
}

function ruleNote(rule: OperationIR["rule"]): string {
  const note = baseNote(rule);
  if (rule.kind === "any" || rule.kind === "all" || rule.kind === "none" || !rule.when) return note;
  return `${note.replace(/\.$/, "")}, only${conditionText(rule.when)}.`;
}

/** The sentence an operation that loads a row gains when the entity answers hidden rows as not found */
function hiddenNote(entity: EntityIR | null, loadsRow: boolean): string {
  return loadsRow && entity?.hidden === "not_found" ? " A row the read rule hides answers 404." : "";
}

function baseNote(rule: OperationIR["rule"]): string {
  switch (rule.kind) {
    case "public":
      return "Open to everyone.";
    case "authenticated":
      return "Needs a signed-in user.";
    case "none":
      return "Not available.";
    case "owner":
      return rule.via
        ? `Only the owner of the row reached through ${ruleKey(rule)}.`
        : `Only the row's owner (${rule.field}).`;
    case "role":
      return `Only users with role ${rule.value}.`;
    case "member": {
      if (rule.through) {
        const of = rule.via
          ? `the ${rule.through.relation} of the row reached through ${rule.via.map(h => h.column).join(".")}`
          : `the row's ${rule.through.relation}`;
        return `Only ${of} (${rule.through.entity})${rule.role ? ` with at least ${rule.role}` : ""}.`;
      }
      return `Only members of the ${rule.via ? `tenant reached through ${ruleKey(rule)}` : `row's tenant (${rule.field})`}${rule.role ? ` with at least role ${rule.role}` : ""}.`;
    }
    case "all":
      return `All of: ${rule.rules.map(r => ruleNote(r).replace(/\.$/, "")).join("; ")}.`;
    case "any":
      return `Any of: ${rule.rules.map(r => ruleNote(r).replace(/\.$/, "")).join("; ")}.`;
  }
}

/** The OpenAPI 3.1 document for the model's REST contract */
export function openapiDocument(ir: IR): Record<string, unknown> {
  const schemas: Record<string, Schema> = { Error: ERROR_SCHEMA };
  if (ir.files) schemas.File = FILE_SCHEMA;
  for (const entity of ir.entities) if (!entity.system) schemas[entity.name] = presentedSchema(entity, ir);
  const paths: Record<string, Record<string, Schema>> = {};
  const tags: { name: string; description?: string }[] = [];
  const idParam = (entity: EntityIR) => {
    const pk = entity.columns.find(c => c.name === entity.primaryKey[0])!;
    return { name: "id", in: "path", required: true, schema: columnSchema({ ...pk, nullable: false }, ir) };
  };
  const session: Schema[] = ir.auth ? [{ cookieAuth: [] }] : [];

  for (const resource of ir.resources) {
    const entity = ir.entities.find(e => e.name === resource.entity)!;
    tags.push({ name: resource.name, description: resource.description });
    for (const op of resource.operations) {
      if (op.rule.kind === "none") continue;
      const item = (paths[openapiPath(op.path)] ??= {});
      const base = {
        tags: [resource.name],
        operationId: `${resource.name}_${op.kind}`,
        description:
          ruleNote(op.rule) + hiddenNote(entity, op.kind === "get" || op.kind === "update" || op.kind === "delete"),
        security: session
      };
      switch (op.kind) {
        case "list": {
          const parameters: Schema[] = [
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
            {
              name: "page_size",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 200, default: op.pageSize }
            }
          ];
          for (const f of op.filters) {
            const c = entity.columns.find(col => col.name === f)!;
            parameters.push({ name: f, in: "query", schema: columnSchema({ ...c, nullable: false }, ir) });
          }
          if (op.sortable.length)
            parameters.push({
              name: "sort",
              in: "query",
              schema: { type: "string", enum: op.sortable.flatMap(f => [`${f}:asc`, `${f}:desc`]) }
            });
          if (op.search.length)
            parameters.push({
              name: "q",
              in: "query",
              description: `Matches ${op.search.join(", ")} as a substring`,
              schema: { type: "string" }
            });
          item.get = {
            ...base,
            summary: `List ${resource.name}`,
            parameters,
            responses: responses(
              data(
                { type: "array", items: presentedSchema(entity, ir, op.include) },
                {
                  page: {
                    type: "object",
                    required: ["page", "page_size", "total"],
                    properties: {
                      page: { type: "integer" },
                      page_size: { type: "integer" },
                      total: { type: "integer" }
                    }
                  }
                }
              )
            )
          };
          break;
        }
        case "get":
          item.get = {
            ...base,
            summary: `Get one of ${resource.name}`,
            parameters: [idParam(entity)],
            responses: responses(data(presentedSchema(entity, ir, op.include)))
          };
          break;
        case "create":
          item.post = {
            ...base,
            ...(op.invite
              ? {
                  description: `${base.description} Mails the address a link; proving the address makes the ${op.invite}. A live invite to the address answers 409 invite_exists, a member's address 409 already_member.`
                }
              : {}),
            summary: op.invite ? `Invite an address (${resource.name})` : `Create one of ${resource.name}`,
            requestBody: {
              required: true,
              content: { "application/json": { schema: inputSchema(entity, op.fields, ir, "create") } }
            },
            responses: responses(data({ $ref: `#/components/schemas/${entity.name}` }), "201", "Created")
          };
          break;
        case "update":
          item.patch = {
            ...base,
            summary: `Update one of ${resource.name}`,
            parameters: [idParam(entity)],
            requestBody: {
              required: true,
              content: { "application/json": { schema: inputSchema(entity, op.fields, ir, "update") } }
            },
            responses: responses(data({ $ref: `#/components/schemas/${entity.name}` }))
          };
          break;
        case "delete":
          item.delete = {
            ...base,
            summary: `Delete one of ${resource.name}`,
            parameters: [idParam(entity)],
            responses: { "204": { description: "Deleted" }, ...ERROR_RESPONSES }
          };
          break;
      }
    }
  }

  for (const action of ir.actions) {
    if (action.rule.kind === "none") continue;
    const entity = action.entity ? ir.entities.find(e => e.name === action.entity)! : null;
    const tag = action.resource ?? "actions";
    if (!tags.some(t => t.name === tag)) tags.push({ name: tag, description: "Actions not tied to a resource" });
    const item = (paths[action.path] ??= {});
    const parameters = action.scope === "row" && entity ? [idParam(entity)] : [];
    const ok: Record<string, Schema> =
      action.returns.kind === "none"
        ? { "204": { description: "Done" } }
        : {
            "200": {
              description: "OK",
              content: data(
                action.returns.kind === "entity"
                  ? { $ref: `#/components/schemas/${entity!.name}` }
                  : fieldsSchema(action.returns.fields, ir)
              )
            }
          };
    item.post = {
      tags: [tag],
      operationId: actionOperationId(action),
      summary: action.description ?? `${toTitleCase(action.name)}${action.resource ? ` (${action.resource})` : ""}`,
      description: ruleNote(action.rule) + hiddenNote(entity, action.scope === "row"),
      security: session,
      parameters,
      ...(action.input.length
        ? {
            requestBody: { required: true, content: { "application/json": { schema: fieldsSchema(action.input, ir) } } }
          }
        : {}),
      responses: { ...ok, ...ERROR_RESPONSES }
    };
  }

  if (ir.auth) {
    tags.push({ name: "auth", description: "Sign-in" });
    const identity = ir.entities.find(e => e.name === ir.auth!.identity)!;
    const user = { $ref: `#/components/schemas/${identity.name}` };
    const invites = ir.auth.invites ?? [];
    /** What a sign-in that proved an invited email answers beside the user */
    const accepted: Record<string, Schema> = invites.length
      ? {
          accepted: {
            type: "array",
            description: "The invites this sign-in accepted, the one whose token was used first",
            items: { $ref: "#/components/schemas/AcceptedInvite" }
          }
        }
      : {};
    /** A reply's content with properties that are only sometimes there */
    const withOptional = (content: Schema, optional: Record<string, Schema>): Schema => {
      const schema = (content["application/json"] as Schema).schema as Schema;
      Object.assign(schema.properties as Schema, optional);
      return content;
    };
    const authPath = (
      p: string,
      op: string,
      summary: string,
      body: Schema | null,
      ok: Schema,
      status = "200",
      optional: Record<string, Schema> = {}
    ) => {
      paths[p] = {
        post: {
          tags: ["auth"],
          operationId: `auth_${op}`,
          summary,
          ...(body ? { requestBody: { required: true, content: { "application/json": { schema: body } } } } : {}),
          responses: responses(withOptional(data(ok), optional), status)
        }
      };
    };
    if (ir.auth.providers.some(p => p.kind === "credentials")) {
      const registerProps: Record<string, Schema> = {
        [ir.auth.emailColumn]: { type: "string", format: "email" },
        password: { type: "string", minLength: 8 }
      };
      for (const f of ir.auth.registerFields)
        registerProps[f] = columnSchema(identity.columns.find(c => c.name === f)!, ir);
      authPath(
        "/api/auth/register",
        "register",
        "Register",
        { type: "object", properties: registerProps, required: [ir.auth.emailColumn, "password"] },
        user,
        "201"
      );
      authPath(
        "/api/auth/login",
        "login",
        "Sign in",
        {
          type: "object",
          properties: {
            [ir.auth.emailColumn]: { type: "string" },
            password: { type: "string" },
            ...(invites.length
              ? { invite: { type: "string", description: "An invite's token: the sign-in accepts it" } }
              : {})
          },
          required: [ir.auth.emailColumn, "password"]
        },
        user,
        "200",
        accepted
      );
    }
    if (ir.auth.providers.some(p => p.kind === "magic_link")) {
      authPath(
        "/api/auth/magic-link",
        "magic_link",
        "Email a sign-in link",
        { type: "object", properties: { email: { type: "string", format: "email" } }, required: ["email"] },
        { type: "object", properties: { sent: { type: "boolean" } } }
      );
      authPath(
        "/api/auth/magic-link/verify",
        "magic_link_verify",
        "Sign in with a link's token",
        { type: "object", properties: { token: { type: "string" } }, required: ["token"] },
        user,
        "200",
        accepted
      );
    }
    if (invites.length) {
      const credentials = ir.auth.providers.some(p => p.kind === "credentials");
      const keyOf = (entityName: string): Schema => {
        const entity = ir.entities.find(e => e.name === entityName)!;
        return columnSchema({ ...entity.columns.find(c => c.name === entity.primaryKey[0])!, nullable: false }, ir);
      };
      const oneOf = (all: Schema[]): Schema => {
        const distinct = [...new Map(all.map(s => [JSON.stringify(s), s])).values()];
        return distinct.length === 1 ? distinct[0] : { oneOf: distinct };
      };
      const parents = [...new Set(invites.map(i => i.parent))];
      const roles = [...new Set(invites.flatMap(i => i.roles ?? []))];
      schemas.AcceptedInvite = {
        type: "object",
        description: "A membership an invite made: the row joined, the role given and the tenant it belongs to",
        required: ["entity", "id", "tenant"],
        properties: {
          entity: { type: "string", enum: parents },
          id: oneOf(parents.map(keyOf)),
          ...(roles.length ? { role: { type: "string", enum: roles } } : {}),
          tenant: ir.auth.tenancy ? { oneOf: [keyOf(ir.auth.tenancy.entity), { type: "null" }] } : { type: "null" }
        }
      };
      const token = { name: "token", in: "path", required: true, schema: { type: "string" } };
      const gone = { "410": { $ref: "#/components/responses/Gone" } };
      paths["/api/auth/invites/{token}"] = {
        get: {
          tags: ["auth"],
          operationId: "auth_invite",
          summary: "What an invite's link is for",
          description: "Never accepts. A token that is unknown, used or revoked answers 404, a lapsed one 410.",
          parameters: [token],
          responses: {
            ...responses(
              data({
                type: "object",
                required: ["entity", "name", "inviter", "email", "expires_at", "account"],
                properties: {
                  entity: { type: "string", enum: parents },
                  name: { type: "string", description: "The display value of the row the invite is to" },
                  ...(roles.length ? { role: { type: "string", enum: roles } } : {}),
                  inviter: { type: "string", description: "The display value of who invited" },
                  email: { type: "string", description: "The address invited, masked" },
                  expires_at: { type: "string", format: "date-time" },
                  account: { type: "boolean", description: "Whether the address already has an account" }
                }
              })
            ),
            ...gone
          }
        }
      };
      const accountProps: Record<string, Schema> = {};
      for (const f of ir.auth.registerFields)
        accountProps[f] = columnSchema(identity.columns.find(c => c.name === f)!, ir);
      if (credentials) accountProps.password = { type: "string", minLength: 8 };
      paths["/api/auth/invites/{token}/accept"] = {
        post: {
          tags: ["auth"],
          operationId: "auth_invite_accept",
          summary: "Accept an invite",
          description:
            "A session under the invite's email accepts, 200. A session under another email answers 403 " +
            "invite_email_mismatch. Without a session, an address that has an account answers 401 sign_in_required, " +
            "and one that has none gets an account made from the body, signed in, 201. One proof accepts every live " +
            "invite to the address.",
          security: session,
          parameters: [token],
          requestBody: {
            required: false,
            description: "Only read when the account is made here",
            content: { "application/json": { schema: { type: "object", properties: accountProps } } }
          },
          responses: {
            ...responses(data(user, accepted)),
            "201": { description: "Account made, signed in and accepted", content: data(user, accepted) },
            ...gone
          }
        }
      };
    }
    for (const p of ir.auth.providers) {
      if (p.kind !== "oauth") continue;
      paths[`/api/auth/oauth/${p.name}`] = {
        get: {
          tags: ["auth"],
          operationId: `auth_oauth_${p.name}`,
          summary: `Start sign-in with ${p.name}`,
          responses: { "302": { description: "Redirects to the provider" } }
        }
      };
      paths[`/api/auth/oauth/${p.name}/callback`] = {
        get: {
          tags: ["auth"],
          operationId: `auth_oauth_${p.name}_callback`,
          summary: `${p.name} sends the user back here`,
          responses: { "302": { description: "Signed in; redirects to the app" } }
        }
      };
    }
    paths["/api/auth/logout"] = {
      post: {
        tags: ["auth"],
        operationId: "auth_logout",
        summary: "Sign out",
        responses: { "204": { description: "Signed out" } }
      }
    };
    paths["/api/auth/me"] = {
      get: {
        tags: ["auth"],
        operationId: "auth_me",
        summary: "The signed-in user",
        security: session,
        responses: responses(data(user))
      }
    };
    paths["/api/auth/providers"] = {
      get: {
        tags: ["auth"],
        operationId: "auth_providers",
        summary: "How users may sign in",
        responses: {
          "200": {
            description: "OK",
            content: data({
              type: "array",
              items: { type: "object", properties: { kind: { type: "string" }, name: { type: "string" } } }
            })
          }
        }
      }
    };
  }

  if (ir.files) {
    tags.push({ name: "files", description: "Uploads" });
    const file = { $ref: "#/components/schemas/File" };
    paths["/api/files"] = {
      post: {
        tags: ["files"],
        operationId: "files_begin",
        summary: "Begin an upload",
        description: ruleNote(ir.files.upload),
        security: session,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "type", "size"],
                properties: { name: { type: "string" }, type: { type: "string" }, size: { type: "integer" } }
              }
            }
          }
        },
        responses: responses(
          data({
            allOf: [
              file,
              {
                type: "object",
                required: ["status", "upload"],
                properties: {
                  status: { type: "string", enum: ["pending", "ready"] },
                  upload: {
                    type: "object",
                    required: ["url", "method"],
                    properties: {
                      url: { type: "string" },
                      method: { type: "string" },
                      headers: { type: "object", additionalProperties: { type: "string" } }
                    }
                  }
                }
              }
            ]
          }),
          "201",
          "Created"
        )
      }
    };
    paths["/api/files/{id}/complete"] = {
      post: {
        tags: ["files"],
        operationId: "files_complete",
        summary: "Mark an upload finished",
        security: session,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: responses(data(file))
      }
    };
    paths["/api/files/{id}"] = {
      get: {
        tags: ["files"],
        operationId: "files_get",
        summary: "A file's metadata and URL",
        description: ruleNote(ir.files.read),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: responses(data(file))
      }
    };
    paths["/api/files/{id}/content"] = {
      get: {
        tags: ["files"],
        operationId: "files_content",
        summary: "The file's bytes (or a redirect to them)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "The bytes" },
          "302": { description: "Redirects to storage" },
          "404": ERROR_RESPONSES["404"]
        }
      },
      put: {
        tags: ["files"],
        operationId: "files_upload_content",
        summary: "Upload the bytes (local storage only)",
        security: session,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: responses(data(file))
      }
    };
  }

  const components: Record<string, unknown> = {
    schemas: Object.fromEntries(Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))),
    responses: {
      BadRequest: {
        description: "Invalid input",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      Unauthorized: {
        description: "Sign in first",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      Forbidden: {
        description: "Not allowed",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      NotFound: {
        description: "No such row",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      Conflict: {
        description: "Conflicts with an existing row",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      ...(ir.auth?.invites?.length
        ? {
            Gone: {
              description: "The invite has lapsed",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
            }
          }
        : {})
    }
  };
  if (ir.auth) components.securitySchemes = { cookieAuth: { type: "apiKey", in: "cookie", name: "osl_session" } };

  return {
    openapi: "3.1.0",
    info: { title: ir.name, version: "1.0.0", description: ir.description ?? `${ir.name}, generated by OSL` },
    tags,
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components
  };
}

function actionOperationId(action: ActionIR): string {
  return action.resource ? `${action.resource}_${action.name}` : `actions_${action.name}`;
}

export type { ResourceIR as OpenapiResource };

/**
 * A change between two OpenAPI documents that a client written against the first would notice: something it
 * could call, send or read is gone or narrower, or a request now needs more.
 */
export interface OpenApiChange {
  kind:
    | "removed_path"
    | "removed_operation"
    | "removed_parameter"
    | "removed_schema"
    | "removed_property"
    | "narrowed_type"
    | "added_required";
  path?: string;
  method?: string;
  schema?: string;
  property?: string;
  detail: string;
}

type Doc = Record<string, unknown>;

/** The breaking changes from `before` to `after`; additions are never breaking */
export function diffOpenApi(before: Doc, after: Doc): OpenApiChange[] {
  const out: OpenApiChange[] = [];
  const pathsOf = (doc: Doc) => (doc.paths ?? {}) as Record<string, Record<string, Schema>>;
  const beforePaths = pathsOf(before);
  const afterPaths = pathsOf(after);
  for (const [p, methods] of Object.entries(beforePaths)) {
    const next = afterPaths[p];
    if (!next) {
      out.push({ kind: "removed_path", path: p, detail: `${p} was removed` });
      continue;
    }
    for (const [m, op] of Object.entries(methods)) {
      const nextOp = next[m];
      const where = `${m.toUpperCase()} ${p}`;
      if (!nextOp) {
        out.push({ kind: "removed_operation", path: p, method: m, detail: `${where} was removed` });
        continue;
      }
      const params = (o: Schema) => ((o.parameters as Schema[] | undefined) ?? []).map(x => `${x.in}:${x.name}`);
      const nextParams = params(nextOp);
      for (const name of params(op))
        if (!nextParams.includes(name))
          out.push({
            kind: "removed_parameter",
            path: p,
            method: m,
            property: name.split(":")[1],
            detail: `${where} lost the parameter ${name.split(":")[1]}`
          });
      const body = (o: Schema): Schema | undefined =>
        ((o.requestBody as Schema | undefined)?.content as Record<string, Schema> | undefined)?.["application/json"]
          ?.schema as Schema | undefined;
      diffSchemas(body(op), body(nextOp), `the body of ${where}`, { path: p, method: m }, true, out);
    }
  }
  const schemasOf = (doc: Doc) => ((doc.components as Schema | undefined)?.schemas ?? {}) as Record<string, Schema>;
  const afterSchemas = schemasOf(after);
  for (const [name, schema] of Object.entries(schemasOf(before))) {
    const next = afterSchemas[name];
    if (!next) {
      out.push({ kind: "removed_schema", schema: name, detail: `the schema ${name} was removed` });
      continue;
    }
    diffSchemas(schema, next, `the schema ${name}`, { schema: name }, false, out);
  }
  return out;
}

function diffSchemas(
  before: Schema | undefined,
  after: Schema | undefined,
  where: string,
  at: Pick<OpenApiChange, "path" | "method" | "schema">,
  isInput: boolean,
  out: OpenApiChange[]
): void {
  if (!before || !after) return;
  const props = (s: Schema) => (s.properties ?? {}) as Record<string, Schema>;
  const beforeProps = props(before);
  const afterProps = props(after);
  for (const [name, prop] of Object.entries(beforeProps)) {
    const next = afterProps[name];
    if (!next) {
      out.push({ ...at, kind: "removed_property", property: name, detail: `${where} lost the property ${name}` });
      continue;
    }
    const narrowed = narrowing(prop, next);
    if (narrowed) out.push({ ...at, kind: "narrowed_type", property: name, detail: `${where}: ${name} ${narrowed}` });
  }
  if (isInput) {
    const required = (s: Schema) => (s.required as string[] | undefined) ?? [];
    const was = required(before);
    for (const name of required(after))
      if (!was.includes(name))
        out.push({ ...at, kind: "added_required", property: name, detail: `${where} now requires ${name}` });
  }
}

/** How a property's schema got narrower, or null when it did not */
function narrowing(before: Schema, after: Schema): string | null {
  const typeOf = (s: Schema) => JSON.stringify(s.type ?? s.$ref ?? s.oneOf ?? s.anyOf ?? null);
  if (typeOf(before) !== typeOf(after)) return `changed type from ${typeOf(before)} to ${typeOf(after)}`;
  if (before.format !== after.format && before.format !== undefined)
    return `changed format from ${before.format} to ${after.format}`;
  const values = (s: Schema) => (s.enum as unknown[] | undefined) ?? null;
  const was = values(before);
  const now = values(after);
  if (was && now) {
    const lost = was.filter(v => !now.some(n => JSON.stringify(n) === JSON.stringify(v)));
    if (lost.length) return `lost the values ${lost.map(v => JSON.stringify(v)).join(", ")}`;
  } else if (!was && now) return `is now limited to ${now.length} values`;
  const max = (s: Schema) => s.maxLength as number | undefined;
  if (max(after) !== undefined && (max(before) === undefined || max(after)! < max(before)!))
    return `shortened to ${max(after)} characters`;
  const items = (s: Schema) => s.items as Schema | undefined;
  if (items(before) && items(after)) {
    const inner = narrowing(items(before)!, items(after)!);
    if (inner) return `items ${inner}`;
  }
  return null;
}

/** What a change is about, read from its path or schema against the IR the document came from */
interface ChangeSubject {
  entities: Set<string>;
  resources: Set<string>;
  actions: Set<string>;
  auth: boolean;
  files: boolean;
}

function subjectOf(change: OpenApiChange, ir: IR): ChangeSubject {
  const subject: ChangeSubject = {
    entities: new Set(),
    resources: new Set(),
    actions: new Set(),
    auth: false,
    files: false
  };
  if (change.schema) {
    subject.entities.add(change.schema);
    for (const r of ir.resources) if (r.entity === change.schema) subject.resources.add(r.name);
  }
  if (change.path) {
    const p = change.path;
    if (p.startsWith("/api/auth")) subject.auth = true;
    else if (p.startsWith("/api/files")) subject.files = true;
    for (const action of ir.actions)
      if (openapiPath(action.path) === p) {
        subject.actions.add(`${action.resource ?? ""}:${action.name}`);
        if (action.resource) subject.resources.add(action.resource);
        if (action.entity) subject.entities.add(action.entity);
      }
    for (const r of ir.resources)
      if (p === openapiPath(r.path) || p.startsWith(`${openapiPath(r.path)}/`)) {
        subject.resources.add(r.name);
        subject.entities.add(r.entity);
      }
  }
  if (ir.auth && (subject.auth || subject.entities.has(ir.auth.identity))) {
    subject.auth = true;
    subject.entities.add(ir.auth.identity);
  }
  // An invite's entity and resource are written from auth.invites over a membership and its parent, so a change to
  // the auth block or to either of those is what explains a change to them
  for (const invite of ir.auth?.invites ?? []) {
    if (!subject.entities.has(invite.entity) && !subject.resources.has(invite.resource)) continue;
    subject.auth = true;
    subject.entities.add(invite.membership);
    subject.entities.add(invite.parent);
  }
  return subject;
}

/**
 * Whether one of a diff's ops accounts for a breaking change: an op on the same entity, resource or action, the
 * auth block for the auth routes, the files block for the file routes. A change no op explains is a compiler
 * regression, not a model change.
 */
export function explainedBy(change: OpenApiChange, ops: DiffOp[], before: IR): boolean {
  const subject = subjectOf(change, before);
  return ops.some(op => {
    switch (op.op) {
      case "remove_entity":
        return subject.entities.has(op.name);
      case "rename_entity":
        return subject.entities.has(op.from) || subject.entities.has(op.to);
      case "add_field":
      case "update_field":
      case "remove_field":
      case "set_rules":
        return subject.entities.has(op.entity);
      case "rename_field":
        return subject.entities.has(op.entity);
      case "add_resource":
      case "update_resource":
      case "remove_resource":
        return subject.resources.has(op.name);
      case "add_action":
      case "update_action":
      case "remove_action":
        return (
          subject.actions.has(`${op.resource ?? ""}:${op.name}`) ||
          (op.resource !== undefined && subject.resources.has(op.resource))
        );
      case "set_auth":
      case "remove_auth":
        return subject.auth;
      case "set_files":
      case "remove_files":
        return subject.files;
      default:
        return false;
    }
  });
}
