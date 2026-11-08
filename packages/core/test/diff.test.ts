import { describe, expect, it } from "vitest";
import { Model, applyDiff, parseDiff } from "../src/index.js";

const base = Model.parse({
  osl: "1.0",
  name: "blog",
  entities: {
    Post: { fields: { id: { type: "uuid", primary: true }, title: { type: "string", required: true } } }
  },
  resources: { posts: { entity: "Post", operations: ["list", "get"] } }
});

describe("applyDiff", () => {
  it("leaves the diff untouched, so the same diff applies twice to the same result", () => {
    const diff = parseDiff({
      osl: "1.0",
      ops: [
        {
          op: "update_resource",
          name: "posts",
          resource: { entity: "Post", operations: ["list", "get", "create"] }
        },
        { op: "add_action", resource: "posts", name: "publish", action: { rule: "public" } }
      ]
    });
    const first = applyDiff(base, diff).model;
    const second = applyDiff(base, diff).model;
    expect(second).toEqual(first);
    expect(first.resources.posts.actions?.publish).toBeDefined();
    expect((diff.ops[0] as { resource: { actions?: unknown } }).resource.actions).toBeUndefined();
    expect(base.resources.posts.actions).toBeUndefined();
  });
});
