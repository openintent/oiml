import { describe, expect, it } from "vitest";
import {
  Model,
  applyDiff,
  compile,
  conditionedRules,
  openRules,
  parseDiff,
  ruleText,
  validateModel
} from "../src/index.js";
import { openapiDocument } from "../src/openapi.js";

/** Published articles are public, drafts are their author's; a done task is frozen */
const base: Model = Model.parse({
  osl: "1.0",
  name: "demo",
  entities: {
    User: {
      fields: {
        id: { type: "uuid", primary: true },
        email: { type: "string", required: true, unique: true },
        name: { type: "string", required: true },
        role: { type: "enum", enum_values: ["member", "admin"], required: true, default: "member" }
      },
      rules: { read: "public", update: "owner:id" }
    },
    Article: {
      fields: {
        id: { type: "uuid", primary: true },
        title: { type: "string", required: true },
        published: { type: "boolean", required: true, default: false },
        status: { type: "enum", enum_values: ["draft", "review", "live"], required: true, default: "draft" },
        views: { type: "integer" },
        author_id: { type: "uuid", required: true, relation: { entity: "User" } }
      },
      rules: {
        read: "public when published = true or owner:author_id or role:admin",
        create: "owner:author_id when published = false",
        update: "owner:author_id when status != live or role:admin"
      }
    }
  },
  auth: { identity: "User", provider: "credentials" },
  resources: {
    users: { entity: "User", operations: ["list", "get"] },
    posts: { entity: "Article", operations: ["list", "get", "create", "update", "delete"] }
  }
});

function withRule(entity: string, operation: string, rule: string): Model {
  const target = base.entities[entity];
  return Model.parse({
    ...base,
    entities: { ...base.entities, [entity]: { ...target, rules: { ...target.rules, [operation]: rule } } }
  });
}

const codes = (m: Model) => validateModel(m).map(d => `${d.code}:${d.path}`);

describe("row conditions on rules", () => {
  it("compile to typed conditions on the predicate they qualify", () => {
    expect(validateModel(base).filter(d => d.level === "error")).toEqual([]);
    const article = compile(base).entities.find(e => e.name === "Article")!;
    expect(article.rules.read).toEqual({
      kind: "any",
      rules: [
        { kind: "public", when: { column: "published", op: "eq", value: true } },
        { kind: "owner", field: "author_id" },
        { kind: "role", value: "admin" }
      ]
    });
    expect(article.rules.create).toEqual({
      kind: "owner",
      field: "author_id",
      when: { column: "published", op: "eq", value: false }
    });
    expect(article.rules.update).toEqual({
      kind: "any",
      rules: [
        { kind: "owner", field: "author_id", when: { column: "status", op: "ne", value: "live" } },
        { kind: "role", value: "admin" }
      ]
    });
    expect(ruleText(article.rules.read)).toBe("public when published = true or owner:author_id or role:admin");
    expect(ruleText(article.rules.update)).toBe("owner:author_id when status != live or role:admin");
    // a conditioned public needs the row, so it is not an open alternative
    expect(openRules(article.rules.read).map(r => r.kind)).toEqual(["role"]);
    expect(conditionedRules(article.rules.read).map(r => r.kind)).toEqual(["public"]);
    // the owner field is still set from the session on create
    const create = compile(base)
      .resources.find(r => r.name === "posts")!
      .operations.find(o => o.kind === "create")!;
    expect(create.kind === "create" && create.ownerField).toBe("author_id");
    const views = compile(withRule("Article", "read", "public when views = null or owner:author_id")).entities.find(
      e => e.name === "Article"
    )!.rules.read;
    expect(views.kind === "any" && views.rules[0]).toEqual({
      kind: "public",
      when: { column: "views", op: "eq", value: null }
    });
  });

  it("refuse conditions that do not fit (M032, M033)", () => {
    expect(codes(withRule("Article", "read", "public when nope = true"))).toContain("M032:entities.Article.rules.read");
    expect(codes(withRule("Article", "delete", "none when published = true"))).toContain(
      "M032:entities.Article.rules.delete"
    );
    expect(codes(withRule("Article", "read", "public when published = yes"))).toContain(
      "M033:entities.Article.rules.read"
    );
    expect(codes(withRule("Article", "read", "public when status = gone"))).toContain(
      "M033:entities.Article.rules.read"
    );
    expect(codes(withRule("Article", "read", "public when title = null"))).toContain(
      "M033:entities.Article.rules.read"
    );
    expect(codes(withRule("Article", "read", "public when views = 3"))).not.toContain(
      "M033:entities.Article.rules.read"
    );
    const files = Model.parse({ ...base, files: { upload: "authenticated when published = true" } });
    expect(codes(files)).toContain("M032:files.upload");
    expect(() => withRule("Article", "read", "public when published")).toThrow();
    expect(() => withRule("Article", "read", "public when published == true")).toThrow();
  });

  it("follow a renamed field and refuse removing one a condition tests", () => {
    const renamed = applyDiff(
      base,
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Article", from: "published", to: "live" }] })
    ).model;
    expect(renamed.entities.Article.rules?.read).toBe("public when live = true or owner:author_id or role:admin");
    expect(renamed.entities.Article.rules?.create).toBe("owner:author_id when live = false");
    expect(() =>
      applyDiff(base, parseDiff({ osl: "1.0", ops: [{ op: "remove_field", entity: "Article", name: "status" }] }))
    ).toThrow(/still uses Article.status/);
  });

  it("show up in the OpenAPI rule notes", () => {
    const doc = openapiDocument(compile(base)) as {
      paths: Record<string, { get?: { description?: string }; post?: { description?: string } }>;
    };
    expect(doc.paths["/api/posts/{id}"].get?.description).toContain("when published = true");
    expect(doc.paths["/api/posts"].post?.description).toContain("only when published = false");
  });
});
