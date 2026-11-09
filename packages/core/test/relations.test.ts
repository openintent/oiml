import { describe, expect, it } from "vitest";
import {
  DiffError,
  Model,
  applyDiff,
  compile,
  conditionKey,
  directOwnerOf,
  parseDiff,
  rowDependentRules,
  rulePaths,
  ruleText,
  validateModel
} from "../src/index.js";
import { openapiDocument } from "../src/openapi.js";

/** Articles can be locked; a comment's rules look at its article, and a conjunction binds the author */
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
        locked: { type: "boolean", required: true, default: false, read_only: true },
        author_id: { type: "uuid", required: true, relation: { entity: "User" } }
      },
      rules: { read: "public", create: "owner:author_id", update: "owner:author_id or role:admin" }
    },
    Comment: {
      fields: {
        id: { type: "uuid", primary: true },
        body: { type: "text", required: true },
        article_id: { type: "uuid", required: true, relation: { entity: "Article", on_delete: "cascade" } },
        author_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
        created_at: { type: "datetime", required: true, default: "now" }
      },
      rules: {
        read: "public when article_id.locked = false or owner:article_id.author_id",
        create: "owner:author_id when article_id.locked = false",
        update: "owner:author_id and role:admin or owner:article_id.author_id",
        delete: "owner:author_id or role:admin"
      }
    }
  },
  auth: { identity: "User", provider: "credentials" },
  resources: {
    posts: { entity: "Article", operations: ["list", "get", "create", "update"] },
    comments: {
      entity: "Comment",
      operations: ["list", "get", "create", "update", "delete"],
      actions: { pin: { rule: "owner:article_id.author_id" } }
    }
  }
});

function withRule(entity: string, operation: string, rule: string): Model {
  const target = base.entities[entity];
  return Model.parse({
    ...base,
    entities: { ...base.entities, [entity]: { ...target, rules: { ...target.rules, [operation]: rule } } }
  });
}

const codes = (m: Model) => validateModel(m).map(d => `${d.level}:${d.code}:${d.path}`);
const hop = { column: "article_id", entity: "Article", table: "articles", targetColumn: "id" };

describe("conditions through relations", () => {
  it("compile the path into the condition and type the literal by the field it reaches", () => {
    expect(validateModel(base).filter(d => d.level === "error")).toEqual([]);
    const comment = compile(base).entities.find(e => e.name === "Comment")!;
    expect(comment.rules.create).toEqual({
      kind: "owner",
      field: "author_id",
      when: { column: "locked", op: "eq", value: false, via: [hop] }
    });
    expect(comment.rules.read).toEqual({
      kind: "any",
      rules: [
        { kind: "public", when: { column: "locked", op: "eq", value: false, via: [hop] } },
        { kind: "owner", field: "author_id", via: [hop] }
      ]
    });
    expect(ruleText(comment.rules.create)).toBe("owner:author_id when article_id.locked = false");
    expect(ruleText(comment.rules.read)).toBe("public when article_id.locked = false or owner:article_id.author_id");
    const when = comment.rules.create.kind === "owner" ? comment.rules.create.when! : undefined;
    expect(conditionKey(when!)).toBe("article_id.locked");
    // every value a row check reads through relations, keyed the way the generated code stores it
    expect([...rulePaths(comment.rules.read).keys()]).toEqual(["article_id.author_id", "article_id.locked"]);
    expect(rulePaths(comment.rules.create).get("article_id.locked")).toEqual({ via: [hop], field: "locked" });
    // the owner field is still set from the session on create
    const create = compile(base)
      .resources.find(r => r.name === "comments")!
      .operations.find(o => o.kind === "create")!;
    expect(create.kind === "create" && create.ownerField).toBe("author_id");
    expect(create.kind === "create" && create.fields).toEqual(["body", "article_id"]);
  });

  it("serve a timer's when through the same path", () => {
    const timed = Model.parse({
      ...base,
      timers: [{ on: "Comment", at: "created_at", after: "30d", run: "comments.pin", when: "article_id.locked = true" }]
    });
    expect(validateModel(timed).filter(d => d.level === "error")).toEqual([]);
    expect(compile(timed).timers[0].when).toEqual({ column: "locked", op: "eq", value: true, via: [hop] });
    const bad = Model.parse({
      ...base,
      timers: [{ on: "Comment", at: "created_at", run: "comments.pin", when: "article_id.locked = maybe" }]
    });
    expect(codes(bad)).toContain("error:M033:timers[0].when");
    const unknown = Model.parse({
      ...base,
      timers: [{ on: "Comment", at: "created_at", run: "comments.pin", when: "body.locked = true" }]
    });
    expect(codes(unknown)).toContain("error:M032:timers[0].when");
  });

  it("refuse paths that do not fit (M032, M033)", () => {
    expect(codes(withRule("Comment", "read", "public when article_id.nope = true"))).toContain(
      "error:M032:entities.Comment.rules.read"
    );
    expect(codes(withRule("Comment", "read", "public when body.locked = true"))).toContain(
      "error:M032:entities.Comment.rules.read"
    );
    expect(codes(withRule("Comment", "read", "public when article_id.locked = maybe"))).toContain(
      "error:M033:entities.Comment.rules.read"
    );
    expect(codes(withRule("Comment", "read", "public when article_id.title = null"))).toContain(
      "error:M033:entities.Comment.rules.read"
    );
    expect(codes(withRule("Comment", "read", "public when article_id.author_id.role = admin"))).not.toContain(
      "error:M033:entities.Comment.rules.read"
    );
  });

  it("follow renames through the path and refuse removing the field it tests", () => {
    const renamed = applyDiff(
      base,
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Article", from: "locked", to: "closed" }] })
    ).model;
    expect(renamed.entities.Comment.rules?.create).toBe("owner:author_id when article_id.closed = false");
    expect(renamed.entities.Comment.rules?.read).toBe(
      "public when article_id.closed = false or owner:article_id.author_id"
    );
    const rehopped = applyDiff(
      base,
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Comment", from: "article_id", to: "post_id" }] })
    ).model;
    expect(rehopped.entities.Comment.rules?.create).toBe("owner:author_id when post_id.locked = false");
    expect(() =>
      applyDiff(base, parseDiff({ osl: "1.0", ops: [{ op: "remove_field", entity: "Article", name: "locked" }] }))
    ).toThrow(/still uses Article.locked/);
    const timed = Model.parse({
      ...base,
      timers: [{ on: "Comment", at: "created_at", run: "comments.pin", when: "article_id.locked = true" }]
    });
    const timerRenamed = applyDiff(
      timed,
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Article", from: "locked", to: "closed" }] })
    ).model;
    expect(timerRenamed.timers[0].when).toBe("article_id.closed = true");
    expect(() =>
      applyDiff(timed, parseDiff({ osl: "1.0", ops: [{ op: "remove_field", entity: "Article", name: "locked" }] }))
    ).toThrow(DiffError);
  });

  it("show up in the OpenAPI rule notes", () => {
    const doc = openapiDocument(compile(base)) as {
      paths: Record<string, { post?: { description?: string }; patch?: { description?: string } }>;
    };
    expect(doc.paths["/api/comments"].post?.description).toContain("only when article_id.locked = false");
    expect(doc.paths["/api/comments/{id}"].patch?.description).toContain("All of:");
  });
});

describe("conjunctions", () => {
  it("bind tighter than or and keep a plain owner part's meaning on writes", () => {
    const comment = compile(base).entities.find(e => e.name === "Comment")!;
    expect(comment.rules.update).toEqual({
      kind: "any",
      rules: [
        {
          kind: "all",
          rules: [
            { kind: "owner", field: "author_id" },
            { kind: "role", value: "admin" }
          ]
        },
        { kind: "owner", field: "author_id", via: [hop] }
      ]
    });
    expect(ruleText(comment.rules.update)).toBe("owner:author_id and role:admin or owner:article_id.author_id");
    expect(rowDependentRules(comment.rules.update).map(r => r.kind)).toEqual(["all", "owner"]);
    expect(directOwnerOf(comment.rules.update)).toBe("author_id");
    const conj = compile(withRule("Comment", "create", "owner:author_id and role:admin")).entities.find(
      e => e.name === "Comment"
    )!;
    expect(conj.rules.create).toEqual({
      kind: "all",
      rules: [
        { kind: "owner", field: "author_id" },
        { kind: "role", value: "admin" }
      ]
    });
    expect(directOwnerOf(conj.rules.create)).toBe("author_id");
    const create = compile(withRule("Comment", "create", "owner:author_id and role:admin"))
      .resources.find(r => r.name === "comments")!
      .operations.find(o => o.kind === "create")!;
    expect(create.kind === "create" && create.ownerField).toBe("author_id");
    // an alternative that is a conjunction binds the owner on update only when every alternative does
    const update = compile(base)
      .resources.find(r => r.name === "comments")!
      .operations.find(o => o.kind === "update")!;
    expect(update.kind === "update" && update.ownerField).toBeUndefined();
    expect(update.kind === "update" && update.fields).toContain("author_id");
  });

  it("refuse none and warn about public inside a conjunction (M034)", () => {
    expect(codes(withRule("Comment", "delete", "none and owner:author_id"))).toContain(
      "error:M034:entities.Comment.rules.delete"
    );
    expect(codes(withRule("Comment", "delete", "public and owner:author_id"))).toContain(
      "warning:M034:entities.Comment.rules.delete"
    );
    expect(codes(withRule("Comment", "delete", "owner:author_id and owner:article_id.author_id"))).not.toContain(
      "error:M034:entities.Comment.rules.delete"
    );
    expect(() => withRule("Comment", "delete", "owner:author_id and")).toThrow();
    expect(() => withRule("Comment", "delete", "and owner:author_id")).toThrow();
  });

  it("follow renames inside a conjunction", () => {
    const renamed = applyDiff(
      base,
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Comment", from: "author_id", to: "writer_id" }] })
    ).model;
    expect(renamed.entities.Comment.rules?.update).toBe("owner:writer_id and role:admin or owner:article_id.author_id");
    expect(() =>
      applyDiff(base, parseDiff({ osl: "1.0", ops: [{ op: "remove_field", entity: "Comment", name: "author_id" }] }))
    ).toThrow(/still uses Comment.author_id/);
  });
});
