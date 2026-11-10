import { describe, expect, it } from "vitest";
import { compile, Model, ModelError, validateModel } from "../src/index.js";

type Step = Record<string, unknown>;

/**
 * Users, posts with a session-bound author and a read-only status, comments over posts, and the steps under test as
 * the one scenario. Posts' get includes the author; the list does not, and a comment's get includes nothing.
 */
function blog(steps: Step[], change: (model: Record<string, any>) => void = () => {}) {
  const model: Record<string, any> = {
    osl: "1.0",
    name: "demo",
    entities: {
      User: {
        fields: {
          id: { type: "uuid", primary: true },
          email: { type: "string", required: true, unique: true },
          name: { type: "string", required: true },
          bio: { type: "text", validate: { max_length: 500 } },
          tagline: { type: "string", max_length: 40 },
          motto: { type: "text" },
          age: { type: "integer", validate: { min: 13, max: 130 } },
          handle: { type: "string", validate: { max_length: 20, pattern: "^[a-z]+$" } },
          recovery: { type: "string", sealed: true }
        },
        rules: { read: "public", update: "owner:id", delete: "none" }
      },
      Post: {
        fields: {
          id: { type: "uuid", primary: true },
          title: { type: "string", required: true, validate: { max_length: 100 } },
          status: { type: "enum", enum_values: ["draft", "live"], required: true, default: "draft", read_only: true },
          author_id: { type: "uuid", required: true, relation: { entity: "User", name: "author" } },
          token: { type: "string", read: "owner:author_id" }
        },
        rules: { read: "public", create: "owner:author_id", update: "owner:author_id", delete: "owner:author_id" }
      },
      Comment: {
        fields: {
          id: { type: "uuid", primary: true },
          body: { type: "text", required: true },
          post_id: { type: "uuid", required: true, relation: { entity: "Post", name: "post" } },
          user_id: { type: "uuid", required: true, relation: { entity: "User", name: "user" } }
        },
        // No plain owner part: whoever may create names the user
        rules: { read: "public", create: "owner:post_id.author_id", update: "owner:user_id", delete: "owner:user_id" }
      }
    },
    auth: { identity: "User", provider: "credentials" },
    resources: {
      users: { entity: "User", operations: ["list", "get", "update"] },
      posts: {
        entity: "Post",
        operations: ["list", "get", "create", "update"],
        get: { include: ["author"] },
        actions: { publish: { returns: "entity", input: { note: { type: "string" } } } }
      },
      comments: { entity: "Comment", operations: ["get", "create"] }
    },
    examples: {
      actors: { alice: { email: "alice@example.com", password: "alice-pass-1", name: "Alice" } },
      scenarios: [{ name: "under test", steps }]
    }
  };
  change(model);
  return Model.parse(model);
}

/** The scenario checks' diagnostics, as `code path: message` */
const found = (model: Model) =>
  validateModel(model)
    .filter(d => d.code === "M078" || d.code === "M079")
    .map(d => `${d.code} ${d.path.replace("examples.scenarios[0].", "")}: ${d.message}`);

const create = (body: Step, status = 201): Step => ({ as: "alice", op: "posts.create", body, expect: { status } });
const update = (op: string, body: Step, status = 200): Step => ({
  as: "alice",
  op,
  path: { id: "00000000-0000-4000-8000-000000000000" },
  body,
  expect: { status }
});

describe("M078: a step that expects success sends what the operation does not accept", () => {
  it("names a field the create rule binds to the session (the channel members of the live run)", () => {
    const problems = found(blog([create({ title: "Hi", author_id: "00000000-0000-4000-8000-000000000000" })]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("M078 steps[0]: posts.create does not accept author_id, so this step answers 400");
    expect(problems[0]).toContain("binds author_id to the session");
  });

  it("names a read-only field, a field a create list leaves out, an unknown key, and an action's unknown input", () => {
    const problems = found(
      blog(
        [
          create({ title: "Hi", status: "live" }),
          update("posts.update", { motto: "x" }),
          update("users.update", { nickname: "al" }),
          update("posts.publish", { note: "n", when: "now" })
        ],
        model => {
          model.entities.Post.fields.motto = { type: "text" };
          model.resources.posts.update = { fields: ["title"] };
        }
      )
    );
    expect(problems.map(p => p.split(":")[0])).toEqual([
      "M078 steps[0]",
      "M078 steps[1]",
      "M078 steps[2]",
      "M078 steps[3]"
    ]);
    expect(problems[0]).toContain("status is read_only");
    expect(problems[1]).toContain("posts.update.fields does not list it");
    expect(problems[2]).toContain("User has no field nickname");
    expect(problems[3]).toContain("takes no input when (its input: note)");
  });

  it("leaves alone a step that sends a refused key to see the refusal, and a key a rule without a plain owner accepts", () => {
    expect(
      found(
        blog([
          create({ title: "Hi", status: "live" }, 400),
          create({ title: "Hi", author_id: "00000000-0000-4000-8000-000000000000" }, 400),
          update("users.update", { nickname: "al" }, 400),
          {
            as: "alice",
            op: "comments.create",
            body: {
              body: "x",
              post_id: "00000000-0000-4000-8000-000000000000",
              user_id: "00000000-0000-4000-8000-000000000001"
            },
            expect: { status: 201 }
          }
        ])
      )
    ).toEqual([]);
  });
});

describe("M078: a step that expects success expects what the answer never carries", () => {
  it("names a relation the get does not include, and one a create answers without", () => {
    const problems = found(
      blog([
        { op: "comments.get", path: { id: "x" }, expect: { status: 200, body: { data: { post: { title: "Hi" } } } } },
        create({ title: "Hi" }),
        {
          ...create({ title: "Hi" }),
          expect: { status: 201, body: { data: { title: "Hi", author: { name: "Alice" } } } }
        }
      ])
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("M078 steps[0]: comments.get answers Comment rows without post");
    expect(problems[0]).toContain("a relation that comments.get does not include");
    expect(problems[1]).toContain("M078 steps[2]: posts.create answers Post rows without author");
    expect(problems[1]).toContain("answers the row without its relations; expect author_id instead");
  });

  it("names a field that is not in the output, and a sealed field no caller may read", () => {
    const problems = found(
      blog([
        { op: "users.get", path: { id: "x" }, expect: { status: 200, body: { data: { nickname: "al" } } } },
        { op: "users.get", path: { id: "x" }, expect: { status: 200, body: { data: { recovery: "x" } } } }
      ])
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("User has no field nickname");
    expect(problems[1]).toContain("recovery's read rule is none");
  });

  it("leaves alone an included relation (the followers of the live run), list rows, and a field some callers read", () => {
    expect(
      found(
        blog([
          {
            op: "posts.get",
            path: { id: "x" },
            expect: { status: 200, body: { data: { title: "Hi", author: { name: "Alice" } } } }
          },
          {
            op: "posts.list",
            expect: { status: 200, body: { data: [{ title: "Hi", author_id: "x" }], page: { total: 1 } } }
          },
          { op: "posts.get", path: { id: "x" }, expect: { status: 200, body: { data: { token: "t" } } } },
          { op: "posts.get", path: { id: "x" }, expect: { status: 404, body: { data: { nickname: "x" } } } }
        ])
      )
    ).toEqual([]);
  });

  it("names a key in a list row", () => {
    const problems = found(
      blog([{ op: "posts.list", expect: { status: 200, body: { data: [{ title: "Hi", author: { name: "A" } }] } } }])
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("a relation that posts.list does not include; add it to list.include of posts");
  });
});

describe("M079: a step that expects 400 sends what every declared limit accepts", () => {
  it("names a value within its field's declared limit (the 474-character bio of the live run)", () => {
    const problems = found(blog([update("users.update", { bio: "a".repeat(474) }, 400)]));
    expect(problems).toEqual([
      "M079 steps[0]: this step expects 400, but users.update accepts every value it sends (bio: 474 characters, within its max_length of 500) and nothing else in it can answer 400, so the server answers 200: send a value its declared limit refuses, or expect the success"
    ]);
  });

  it("names numbers within their range and a create whose body is complete", () => {
    expect(found(blog([update("users.update", { age: 40, tagline: "short" }, 400)]))[0]).toContain(
      "age: 40, within 13 to 130; tagline: 5 characters, within its max_length of 40"
    );
    expect(found(blog([create({ title: "Hi" }, 400)]))[0]).toContain("so the server answers 201");
  });

  it("leaves alone a value past the limit, a field with no declared limit, and values it cannot judge", () => {
    expect(
      found(
        blog([
          update("users.update", { bio: "a".repeat(501) }, 400),
          update("users.update", { age: 12 }, 400),
          update("users.update", { age: "forty" }, 400),
          update("users.update", { tagline: "a".repeat(41) }, 400),
          // No declared limit: a hook of the developer's may be what refuses it
          update("users.update", { motto: "anything" }, 400),
          update("users.update", { name: "Al" }, 400),
          // A pattern is another engine's to judge; non-ASCII lengths are counted differently
          update("users.update", { handle: "abc" }, 400),
          update("users.update", { bio: "é".repeat(10) }, 400),
          // A key the input refuses, a template, an empty body
          update("users.update", { bio: "ok", nickname: "x" }, 400),
          update("users.update", { bio: "{captured}" }, 400),
          update("users.update", {}, 400),
          // A create missing a required field, and one naming a relation whose row may not exist
          create({ status: "draft" }, 400),
          {
            as: "alice",
            op: "comments.create",
            body: {
              body: "x",
              post_id: "00000000-0000-4000-8000-000000000000",
              user_id: "00000000-0000-4000-8000-000000000001"
            },
            expect: { status: 400 }
          }
        ])
      )
    ).toEqual([]);
  });

  it("leaves alone an operation with an inline event, whose handler may refuse", () => {
    const step = update("users.update", { bio: "a".repeat(474) }, 400);
    expect(found(blog([step]))).toHaveLength(1);
    expect(
      found(blog([step], model => (model.events = [{ on: "User.updated", handler: "check_bio", delivery: "inline" }])))
    ).toEqual([]);
  });

  it("says when the limit is a max_length a text field never checks", () => {
    const problems = found(
      blog([update("users.update", { motto: "a".repeat(600) }, 400)], model => {
        model.entities.User.fields.motto = { type: "text", max_length: 500 };
      })
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("motto: 600 characters (max_length is not checked on a text field");
  });
});

describe("the scenario checks", () => {
  it("make compile refuse the model, as osl propose and osl apply do", () => {
    expect(() => compile(blog([update("users.update", { bio: "a".repeat(474) }, 400)]))).toThrow(ModelError);
    expect(() => compile(blog([update("users.update", { bio: "a".repeat(501) }, 400)]))).not.toThrow();
  });

  it("wait until the rest of the model is valid", () => {
    const model = blog([
      create({ title: "Hi", status: "live" }),
      { as: "nobody", op: "posts.list", expect: { status: 200 } }
    ]);
    const codes = validateModel(model).map(d => d.code);
    expect(codes).toContain("M070");
    expect(codes).not.toContain("M078");
  });
});
