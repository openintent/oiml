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

describe("step templates", () => {
  it("must be captured earlier in the scenario, and {actor.id} needs an actor", () => {
    const withAuth = Model.parse({
      osl: "1.0",
      name: "demo",
      entities: {
        User: {
          fields: {
            id: { type: "uuid", primary: true },
            email: { type: "string", required: true, unique: true },
            name: { type: "string", required: true }
          }
        },
        Note: {
          fields: {
            id: { type: "uuid", primary: true },
            body: { type: "text", required: true },
            author_id: { type: "uuid", required: true, relation: { entity: "User" } }
          },
          rules: { create: "owner:author_id" }
        }
      },
      auth: { identity: "User", provider: "credentials" },
      resources: { notes: { entity: "Note", operations: ["list", "get", "create"] } },
      examples: {
        actors: { alice: { email: "alice@example.com", password: "alice-pass-1", name: "Alice" } },
        scenarios: [
          {
            name: "templates",
            steps: [
              { op: "notes.get", path: { id: "{note}" }, expect: { status: 404 } },
              {
                as: "alice",
                op: "notes.create",
                body: { body: "x" },
                expect: { status: 201, body: { data: { author_id: "{actor.id}" } } },
                capture: { note: "data.id" }
              },
              {
                op: "notes.get",
                path: { id: "{note}" },
                expect: { status: 200, body: { data: { author_id: "{alice.id}" } } }
              },
              {
                op: "notes.get",
                path: { id: "{note}" },
                expect: { status: 200, body: { data: { author_id: "{actor.id}" } } }
              }
            ]
          }
        ]
      }
    });
    const problems = validateModel(withAuth).filter(d => d.code === "M077");
    expect(problems.map(d => d.path)).toEqual([
      "examples.scenarios[0].steps[0]",
      "examples.scenarios[0].steps[2]",
      "examples.scenarios[0].steps[3]"
    ]);
    expect(problems[0].message).toContain("{note}");
    expect(problems[1].message).toContain("not addressable by name");
    expect(problems[2].message).toContain("as: <actor>");
  });
});
