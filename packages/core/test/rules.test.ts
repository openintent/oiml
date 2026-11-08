import { describe, expect, it } from "vitest";
import { Model, applyDiff, compile, parseDiff, ruleText, validateModel } from "../src/index.js";

/** Users own articles; comments point at an article and at their author */
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
      rules: { read: "public", update: "owner:id", delete: "role:admin" }
    },
    Article: {
      fields: {
        id: { type: "uuid", primary: true },
        title: { type: "string", required: true },
        author_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } }
      },
      rules: {
        read: "public",
        create: "owner:author_id",
        update: "owner:author_id or role:admin",
        delete: "owner:author_id or role:admin"
      }
    },
    Comment: {
      fields: {
        id: { type: "uuid", primary: true },
        body: { type: "text", required: true },
        article_id: { type: "uuid", required: true, relation: { entity: "Article", on_delete: "cascade" } },
        author_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } }
      },
      rules: {
        read: "public",
        create: "owner:author_id",
        update: "owner:author_id",
        delete: "owner:author_id or owner:article_id.author_id or role:admin"
      }
    }
  },
  auth: { identity: "User", providers: ["credentials"] },
  resources: {
    posts: { entity: "Article", operations: ["list", "get", "create", "update", "delete"] },
    comments: {
      entity: "Comment",
      operations: ["list", "get", "create", "update", "delete"],
      actions: { pin: { rule: "owner:article_id.author_id", returns: "entity" } }
    }
  }
});

const withRule = (entity: string, action: string, rule: string): Model =>
  structuredClone({
    ...base,
    entities: {
      ...base.entities,
      [entity]: { ...base.entities[entity], rules: { ...base.entities[entity].rules, [action]: rule } }
    }
  }) as Model;

describe("rule alternatives and relation paths", () => {
  it("accepts alternatives and paths and compiles them", () => {
    expect(validateModel(base).filter(d => d.level === "error")).toEqual([]);
    const ir = compile(base);
    const article = ir.entities.find(e => e.name === "Article")!;
    expect(article.rules.update).toEqual({
      kind: "any",
      rules: [
        { kind: "owner", field: "author_id" },
        { kind: "role", value: "admin" }
      ]
    });
    const comment = ir.entities.find(e => e.name === "Comment")!;
    expect(comment.rules.delete).toEqual({
      kind: "any",
      rules: [
        { kind: "owner", field: "author_id" },
        {
          kind: "owner",
          field: "author_id",
          via: [{ column: "article_id", entity: "Article", table: "articles", targetColumn: "id" }]
        },
        { kind: "role", value: "admin" }
      ]
    });
    expect(ruleText(comment.rules.delete)).toBe("owner:author_id or owner:article_id.author_id or role:admin");
    const pin = ir.actions.find(a => a.name === "pin")!;
    expect(pin.rule).toEqual({
      kind: "owner",
      field: "author_id",
      via: [{ column: "article_id", entity: "Article", table: "articles", targetColumn: "id" }]
    });
  });

  it("sets the owner from the session only for a plain owner alternative", () => {
    const ir = compile(base);
    const posts = ir.resources.find(r => r.name === "posts")!;
    const create = posts.operations.find(o => o.kind === "create")!;
    expect(create.kind === "create" && create.ownerField).toBe("author_id");
    // With alternatives an admin may reassign, so the owner column stays writable; a plain owner rule keeps it out
    const update = posts.operations.find(o => o.kind === "update")!;
    expect(update.kind === "update" && update.fields).toContain("author_id");
    const comments = ir.resources.find(r => r.name === "comments")!;
    const commentUpdate = comments.operations.find(o => o.kind === "update")!;
    expect(commentUpdate.kind === "update" && commentUpdate.fields).not.toContain("author_id");
    const viaOnly = withRule("Comment", "create", "owner:article_id.author_id");
    const viaComments = compile(viaOnly).resources.find(r => r.name === "comments")!;
    const commentCreate = viaComments.operations.find(o => o.kind === "create")!;
    expect(commentCreate.kind === "create" && commentCreate.ownerField).toBeUndefined();
    expect(commentCreate.kind === "create" && commentCreate.fields).toContain("article_id");
  });

  it("rejects a path through a field that is not a relation, and a missing field at its end", () => {
    const codes = (m: Model) => validateModel(m).map(d => `${d.code}:${d.path}`);
    expect(codes(withRule("Comment", "delete", "owner:body.author_id"))).toContain(
      "M028:entities.Comment.rules.delete"
    );
    expect(codes(withRule("Comment", "delete", "owner:article_id.writer_id"))).toContain(
      "M020:entities.Comment.rules.delete"
    );
    expect(codes(withRule("Comment", "delete", "owner:article_id.title"))).toContain(
      "M022:entities.Comment.rules.delete"
    );
  });

  it("warns when public is one of several alternatives", () => {
    const problems = validateModel(withRule("Article", "update", "public or role:admin"));
    expect(problems.find(d => d.code === "M029")?.level).toBe("warning");
  });

  it("renames a field inside rules on the entity and along paths from other entities", () => {
    const renamed = applyDiff(
      base,
      parseDiff({
        osl: "1.0",
        ops: [{ op: "rename_field", entity: "Article", from: "author_id", to: "writer_id" }]
      })
    ).model;
    expect(renamed.entities.Article.rules?.update).toBe("owner:writer_id or role:admin");
    expect(renamed.entities.Comment.rules?.delete).toBe("owner:author_id or owner:article_id.writer_id or role:admin");
    expect(renamed.resources.comments.actions?.pin.rule).toBe("owner:article_id.writer_id");
    const hop = applyDiff(
      base,
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Comment", from: "article_id", to: "post_id" }] })
    ).model;
    expect(hop.entities.Comment.rules?.delete).toBe("owner:author_id or owner:post_id.author_id or role:admin");
  });

  it("refuses to remove a field a rule reaches through a path", () => {
    expect(() =>
      applyDiff(base, parseDiff({ osl: "1.0", ops: [{ op: "remove_field", entity: "Article", name: "author_id" }] }))
    ).toThrow(/rule .* still uses Article.author_id/);
  });
});
