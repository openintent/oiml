/**
 * An OpenAPI 3.1 document for the REST contract, as a pure function of the IR. Backends that speak REST
 * write it to generated/openapi.json and serve it at /api/openapi.json; the document is the same for all.
 */
import type { ActionIR, ColumnIR, EntityIR, IR, OperationIR, ResourceIR } from "./ir.js";
import { toTitleCase } from "./naming.js";

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
    properties[c.name] = columnSchema(c, ir);
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
  switch (rule.kind) {
    case "public":
      return "Open to everyone.";
    case "authenticated":
      return "Needs a signed-in user.";
    case "none":
      return "Not available.";
    case "owner":
      return `Only the row's owner (${rule.field}).`;
    case "role":
      return `Only users with role ${rule.value}.`;
    case "member":
      return `Only members of the row's tenant (${rule.field})${rule.role ? ` with at least role ${rule.role}` : ""}.`;
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
        description: ruleNote(op.rule),
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
            summary: `Create one of ${resource.name}`,
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
      description: ruleNote(action.rule),
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
    const authPath = (p: string, op: string, summary: string, body: Schema | null, ok: Schema, status = "200") => {
      paths[p] = {
        post: {
          tags: ["auth"],
          operationId: `auth_${op}`,
          summary,
          ...(body ? { requestBody: { required: true, content: { "application/json": { schema: body } } } } : {}),
          responses: responses(data(ok), status)
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
          properties: { [ir.auth.emailColumn]: { type: "string" }, password: { type: "string" } },
          required: [ir.auth.emailColumn, "password"]
        },
        user
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
        user
      );
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
      }
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
