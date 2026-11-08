import { describe, expect, it } from "vitest";
import { Model, validateModel } from "../src/index.js";

const model = Model.parse({
  osl: "1.0",
  name: "demo",
  entities: {
    Note: { fields: { id: { type: "uuid", primary: true }, body: { type: "text", required: true } } }
  },
  resources: {
    notes: {
      entity: "Note",
      operations: ["list", "get", "update", "delete"],
      actions: { pin: { returns: "entity" }, purge: { scope: "collection", returns: "none" } }
    }
  },
  examples: {
    scenarios: [
      {
        name: "ids",
        steps: [
          { op: "notes.get", expect: { status: 404 } },
          { op: "notes.update", body: { body: "x" }, expect: { status: 404 } },
          { op: "notes.pin", expect: { status: 404 } },
          { op: "notes.purge", expect: { status: 204 } },
          { op: "notes.list", expect: { status: 200 } },
          { op: "notes.delete", path: { id: "not-a-uuid" }, expect: { status: 404 } }
        ]
      }
    ]
  }
});

describe("scenario steps about one row", () => {
  it("need path.id for get, update, delete and row actions", () => {
    const missing = validateModel(model)
      .filter(d => d.code === "M072")
      .map(d => d.path);
    expect(missing).toEqual([
      "examples.scenarios[0].steps[0]",
      "examples.scenarios[0].steps[1]",
      "examples.scenarios[0].steps[2]"
    ]);
  });
});

describe("resources", () => {
  it("refuse an entity with a composite primary key", () => {
    const problems = validateModel(
      Model.parse({
        osl: "1.0",
        name: "demo",
        entities: {
          Post: { fields: { id: { type: "uuid", primary: true } } },
          Tag: { fields: { id: { type: "uuid", primary: true } } },
          PostTag: {
            fields: {
              post_id: { type: "uuid", primary: true, relation: { entity: "Post" } },
              tag_id: { type: "uuid", primary: true, relation: { entity: "Tag" } }
            }
          }
        },
        resources: { post_tags: { entity: "PostTag", operations: ["list"] } }
      })
    );
    expect(problems.map(d => d.code)).toContain("M054");
  });
});
