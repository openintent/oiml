import { describe, expect, it } from "vitest";
import { Model, applyDiff, compile, parseDiff, validateModel } from "../src/index.js";
import { openapiDocument } from "../src/openapi.js";

/** Announcements with private drafts: a row the read rule hides answers not found */
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
    Announcement: {
      fields: {
        id: { type: "uuid", primary: true },
        title: { type: "string", required: true },
        published: { type: "boolean", required: true, default: false, read_only: true },
        author_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } }
      },
      rules: {
        read: "public when published = true or owner:author_id or role:admin",
        create: "owner:author_id",
        update: "owner:author_id or role:admin",
        hidden: "not_found"
      }
    }
  },
  auth: { identity: "User", provider: "credentials" },
  resources: {
    announcements: {
      entity: "Announcement",
      operations: ["list", "get", "create", "update", "delete"],
      actions: { publish: { rule: "owner:author_id or role:admin" } }
    }
  }
});

function withRules(rules: Record<string, string>): Model {
  const target = base.entities.Announcement;
  return Model.parse({ ...base, entities: { ...base.entities, Announcement: { ...target, rules } } });
}

const codes = (m: Model) => validateModel(m).map(d => `${d.level}:${d.code}:${d.path}`);

describe("hidden rows as not found", () => {
  it("compile the key beside the rules, forbidden by default", () => {
    expect(validateModel(base).filter(d => d.level !== "info")).toEqual([]);
    const ir = compile(base);
    expect(ir.entities.find(e => e.name === "Announcement")!.hidden).toBe("not_found");
    expect(ir.entities.find(e => e.name === "User")!.hidden).toBe("forbidden");
    // the rules themselves are untouched by the key
    expect(Object.keys(ir.entities.find(e => e.name === "Announcement")!.rules)).toEqual([
      "read",
      "create",
      "update",
      "delete"
    ]);
  });

  it("warn when the read rule never hides a row (M035) and refuse other values", () => {
    for (const read of ["public", "authenticated", "role:admin", "none", "authenticated or role:admin"]) {
      expect(codes(withRules({ read, hidden: "not_found" }))).toContain(
        "warning:M035:entities.Announcement.rules.hidden"
      );
    }
    for (const read of [
      "owner:author_id",
      "member:author_id",
      "public when published = true",
      "role:admin or owner:author_id"
    ]) {
      const model = withRules({ read, hidden: "not_found" });
      expect(codes(model).filter(c => c.includes("M035"))).toEqual([]);
    }
    expect(codes(withRules({ read: "public", hidden: "forbidden" })).filter(c => c.includes("M035"))).toEqual([]);
    expect(() => withRules({ read: "owner:author_id", hidden: "maybe" })).toThrow();
  });

  it("tell the OpenAPI reader which operations answer 404 for a hidden row", () => {
    const doc = openapiDocument(compile(base)) as {
      paths: Record<string, Record<string, { operationId: string; description: string }>>;
    };
    const byId = Object.fromEntries(
      Object.values(doc.paths)
        .flatMap(item => Object.values(item))
        .map(op => [op.operationId, op.description])
    );
    const note = /A row the read rule hides answers 404\.$/;
    expect(byId.announcements_get).toMatch(note);
    expect(byId.announcements_update).toMatch(note);
    expect(byId.announcements_delete).toMatch(note);
    expect(byId.announcements_publish).toMatch(note);
    expect(byId.announcements_list).not.toMatch(/404/);
    expect(byId.announcements_create).not.toMatch(/404/);
    const plain = openapiDocument(compile(withRules({ read: "owner:author_id" }))) as typeof doc;
    expect(plain.paths["/api/announcements/{id}"].get.description).not.toMatch(/404/);
  });

  it("travel with set_rules", () => {
    const next = applyDiff(
      base,
      parseDiff({
        osl: "1.0",
        ops: [{ op: "set_rules", entity: "Announcement", rules: { read: "owner:author_id", hidden: "forbidden" } }]
      })
    ).model;
    expect(compile(next).entities.find(e => e.name === "Announcement")!.hidden).toBe("forbidden");
    const dropped = applyDiff(
      base,
      parseDiff({ osl: "1.0", ops: [{ op: "set_rules", entity: "Announcement", rules: { read: "owner:author_id" } }] })
    ).model;
    expect(compile(dropped).entities.find(e => e.name === "Announcement")!.hidden).toBe("forbidden");
  });
});
