import { describe, expect, it } from "vitest";
import { Model, compile, validateModel } from "../src/index.js";
import { openapiDocument } from "../src/openapi.js";

/** Users carry a ban the server records and a role operators set; articles count their views */
const base: Model = Model.parse({
  osl: "1.0",
  name: "demo",
  entities: {
    User: {
      fields: {
        id: { type: "uuid", primary: true },
        email: { type: "string", required: true, unique: true },
        name: { type: "string", required: true },
        role: { type: "enum", enum_values: ["member", "admin"], required: true, default: "member", read_only: true },
        banned: { type: "boolean", required: true, default: false, read_only: true },
        banned_at: { type: "datetime", read_only: true }
      },
      rules: { read: "public", update: "owner:id" }
    },
    Article: {
      fields: {
        id: { type: "uuid", primary: true },
        title: { type: "string", required: true },
        author_id: { type: "uuid", required: true, relation: { entity: "User" } },
        view_count: { type: "integer", required: true, default: 0, read_only: true }
      },
      rules: { read: "public", create: "owner:author_id", update: "owner:author_id or role:admin" }
    }
  },
  auth: { identity: "User", provider: "credentials" },
  resources: {
    users: { entity: "User", operations: ["list", "get", "update"], actions: { ban: { rule: "role:admin" } } },
    posts: { entity: "Article", operations: ["list", "get", "create", "update"] }
  },
  examples: {
    actors: {
      admin: { email: "admin@example.com", password: "admin-pass-1", name: "Admin", role: "admin", banned: false }
    }
  }
});

function withField(entity: string, name: string, field: Record<string, unknown>): Model {
  const target = base.entities[entity];
  return Model.parse({
    ...base,
    entities: { ...base.entities, [entity]: { ...target, fields: { ...target.fields, [name]: field } } }
  });
}

const codes = (m: Model) => validateModel(m).map(d => `${d.code}:${d.path}`);

describe("read_only fields", () => {
  it("stay out of register, create and update, and actors may still provision them", () => {
    expect(validateModel(base).filter(d => d.level === "error")).toEqual([]);
    const ir = compile(base);
    expect(ir.auth?.registerFields).toEqual(["name"]);
    const posts = ir.resources.find(r => r.name === "posts")!;
    const create = posts.operations.find(o => o.kind === "create")!;
    const update = posts.operations.find(o => o.kind === "update")!;
    expect(create.kind === "create" && create.fields).toEqual(["title"]);
    expect(update.kind === "update" && update.fields).toEqual(["title", "author_id"]);
    const users = ir.resources.find(r => r.name === "users")!;
    const userUpdate = users.operations.find(o => o.kind === "update")!;
    expect(userUpdate.kind === "update" && userUpdate.fields).toEqual(["email", "name"]);
    expect(users.outputFields).toEqual(expect.arrayContaining(["banned", "banned_at", "role"]));
    expect(ir.examples.actors.admin.provisioned).toEqual({ role: "admin", banned: false });
    const user = ir.entities.find(e => e.name === "User")!;
    expect(user.columns.find(c => c.name === "banned")?.readOnly).toBe(true);
    expect(user.columns.find(c => c.name === "name")?.readOnly).toBeUndefined();
  });

  it("are marked readOnly in the OpenAPI document", () => {
    const doc = openapiDocument(compile(base)) as {
      components: { schemas: Record<string, { properties: Record<string, { readOnly?: boolean }> }> };
    };
    expect(doc.components.schemas.User.properties.banned.readOnly).toBe(true);
    expect(doc.components.schemas.User.properties.name.readOnly).toBeUndefined();
  });

  it("cannot be listed in create or update fields (M064)", () => {
    const posts = { ...base.resources.posts, create: { fields: ["title", "view_count"] } };
    const m = Model.parse({ ...base, resources: { ...base.resources, posts } });
    expect(codes(m)).toContain("M064:resources.posts.create.fields");
  });

  it("need a default or an owner rule when required (M065)", () => {
    expect(codes(withField("Article", "view_count", { type: "integer", required: true, read_only: true }))).toContain(
      "M065:entities.Article.fields.view_count"
    );
    // the owner field comes from the session, so it may be read_only without a default
    const owned = withField("Article", "author_id", {
      type: "uuid",
      required: true,
      read_only: true,
      relation: { entity: "User" }
    });
    expect(codes(owned)).not.toContain("M065:entities.Article.fields.author_id");
    expect(validateModel(owned).filter(d => d.level === "error")).toEqual([]);
    const update = compile(owned)
      .resources.find(r => r.name === "posts")!
      .operations.find(o => o.kind === "update")!;
    expect(update.kind === "update" && update.fields).toEqual(["title"]);
  });

  it("are refused on hidden fields and primary keys", () => {
    expect(() => withField("User", "secret", { type: "string", hidden: true, read_only: true })).toThrow(/hidden/);
    expect(() => withField("Article", "id", { type: "uuid", primary: true, read_only: true })).toThrow(/primary/);
  });
});
