import { describe, expect, it } from "vitest";
import {
  Model,
  applyDiff,
  archiveNameClash,
  compile,
  diffOpenApi,
  fromYaml,
  explainedBy,
  hasTransition,
  isTransitionAction,
  openapiDocument,
  parseDiff,
  resolveStepOp,
  statementActions,
  transitionOf,
  transitionsOf,
  userActions,
  validateModel
} from "../src/index.js";

/** Articles that go through a review: a status only its transitions move, with a stamp and a rule per step */
function model(change: (m: Record<string, any>) => void = () => {}): Model {
  const raw: Record<string, any> = {
    osl: "1.0",
    name: "desk",
    entities: {
      User: {
        fields: {
          id: { type: "uuid", primary: true },
          email: { type: "string", required: true, unique: true },
          role: { type: "enum", enum_values: ["member", "editor"], required: true, default: "member" }
        },
        rules: { read: "public", update: "owner:id", delete: "none" }
      },
      Article: {
        fields: {
          id: { type: "uuid", primary: true },
          author_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
          title: { type: "string", required: true },
          status: {
            type: "enum",
            enum_values: ["draft", "in_review", "published", "retired"],
            required: true,
            default: "draft",
            read_only: true
          },
          published_at: { type: "datetime", read_only: true }
        },
        rules: { read: "public", create: "owner:author_id", update: "owner:author_id", delete: "owner:author_id" },
        transitions: {
          field: "status",
          submit: { from: ["draft"], to: "in_review" },
          approve: { from: ["in_review"], to: "published", rule: "role:editor", stamp: "published_at" },
          reject: { from: ["in_review"], to: "draft", rule: "role:editor" },
          retire: { from: ["published"], to: "retired", rule: "role:editor or owner:author_id when status = published" }
        }
      }
    },
    resources: {
      articles: {
        entity: "Article",
        operations: ["list", "get", "create", "update", "delete"],
        list: { filters: ["status"] }
      }
    },
    auth: { identity: "User", provider: "credentials" }
  };
  change(raw);
  return Model.parse(raw);
}

const codes = (m: Model) => validateModel(m).map(d => `${d.level} ${d.code}`);
const messages = (m: Model, code: string) =>
  validateModel(m)
    .filter(d => d.code === code)
    .map(d => d.message);

describe("transitions in the model", () => {
  it("reads the block: one field, and every other key a transition in declared order", () => {
    const m = model();
    expect(validateModel(m)).toEqual([]);
    const machine = transitionsOf(m.entities.Article)!;
    expect(machine.field).toBe("status");
    expect(machine.steps.map(s => s.name)).toEqual(["submit", "approve", "reject", "retire"]);
    expect(machine.steps[1]).toEqual({
      name: "approve",
      from: ["in_review"],
      to: "published",
      rule: "role:editor",
      stamp: "published_at"
    });
    expect(transitionsOf(m.entities.User)).toBeUndefined();
    expect(hasTransition(m.entities.Article, "submit")).toBe(true);
    expect(hasTransition(m.entities.Article, "field")).toBe(false);
    // Written back, the model parses to itself
    expect(Model.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it("refuses a block without a transition, a name that is not snake_case and a key a transition does not have", () => {
    expect(() => model(m => (m.entities.Article.transitions = { field: "status" }))).toThrow(/at least one transition/);
    expect(() =>
      model(m => (m.entities.Article.transitions = { field: "status", Submit: { from: ["draft"], to: "in_review" } }))
    ).toThrow(/snake_case/);
    expect(() =>
      model(m => (m.entities.Article.transitions.submit = { from: ["draft"], to: "in_review", input: {} }))
    ).toThrow();
    expect(() => model(m => (m.entities.Article.transitions.submit = { from: [], to: "in_review" }))).toThrow();
  });

  it("wants a read-only enum for the field (M160)", () => {
    for (const field of [
      { type: "enum", enum_values: ["draft", "in_review", "published", "retired"], required: true, default: "draft" },
      { type: "string", read_only: true }
    ])
      expect(codes(model(m => (m.entities.Article.fields.status = field)))).toContain("error M160");
    expect(codes(model(m => (m.entities.Article.transitions.field = "stage")))).toEqual(["error M160"]);
  });

  it("wants declared values, and a transition that changes the state (M161)", () => {
    const unknown = model(m => (m.entities.Article.transitions.submit.to = "pending"));
    expect(messages(unknown, "M161")[0]).toContain("pending is not a value of Article.status");
    expect(codes(model(m => (m.entities.Article.transitions.submit.from = ["draft", "in_review"])))).toEqual([
      "error M161"
    ]);
    expect(codes(model(m => (m.entities.Article.transitions.reject.from = ["in_review", "in_review"])))).toEqual([
      "error M161"
    ]);
  });

  it("keeps a name for one thing: a declared action, move, archive and restore (M162, M151)", () => {
    const declared = model(m => (m.resources.articles.actions = { submit: { rule: "owner:author_id" } }));
    expect(messages(declared, "M162")[0]).toContain("drop the action (the transition is its handler now)");
    expect(codes(model(m => (m.entities.Article.transitions.update = { from: ["draft"], to: "retired" })))).toEqual([
      "error M162"
    ]);
    const archiving = (archive: unknown) =>
      model(m => {
        if (archive) m.entities.Article.archive = archive;
        m.entities.Article.transitions.archive = { from: ["published"], to: "retired" };
        delete m.entities.Article.transitions.retire;
      });
    expect(messages(archiving(true), "M151")).toEqual([
      archiveNameClash("articles", "Article", "archived_at", "transition", "archive")
    ]);
    // Without archive: on the entity the name is the model's, as in the design note's own example
    expect(codes(archiving(undefined))).toEqual([]);
    const ordered = model(m => {
      m.entities.Article.fields.place = { type: "integer", position: { within: "author_id" } };
      m.entities.Article.transitions.move = { from: ["draft"], to: "retired" };
    });
    expect(messages(ordered, "M162")[0]).toContain("move is the compiler's reorder");
  });

  it("stamps a nullable read-only datetime (M163) and checks the rule like any rule of the entity", () => {
    for (const field of [{ type: "datetime" }, { type: "datetime", read_only: true, required: true, default: "now" }])
      expect(codes(model(m => (m.entities.Article.fields.published_at = field)))).toContain("error M163");
    expect(codes(model(m => (m.entities.Article.transitions.approve.stamp = "printed_at")))).toEqual(["error M163"]);
    const archived = model(m => {
      m.entities.Article.archive = true;
      m.entities.Article.transitions.approve.stamp = "archived_at";
    });
    expect(messages(archived, "M163")[0]).toContain("and not the archive field");
    const bad = validateModel(model(m => (m.entities.Article.transitions.reject.rule = "owner:editor_id")));
    expect(bad).toHaveLength(1);
    expect(bad[0].path).toBe("entities.Article.transitions.reject.rule");
  });

  it("is a step and an event under any rule but none, and a timer's whatever the rule", () => {
    const m = model();
    expect(resolveStepOp(m, "articles.approve")).toEqual({ kind: "action", resource: "articles", action: "approve" });
    expect(isTransitionAction(m, m.resources.articles, "submit")).toBe(true);
    expect(codes(model(x => (x.events = [{ on: "articles.approve", handler: "article_approved" }])))).toEqual([]);
    const system = model(x => {
      x.entities.Article.transitions.expire = { from: ["in_review"], to: "draft", rule: "none" };
      x.timers = [{ on: "Article", at: "published_at", after: "30d", run: "articles.expire" }];
    });
    expect(validateModel(system)).toEqual([]);
    expect(isTransitionAction(system, system.resources.articles, "expire")).toBe(false);
    expect(resolveStepOp(system, "articles.expire").kind).toBe("unknown");
    expect(
      codes(
        model(x => {
          x.entities.Article.transitions.expire = { from: ["in_review"], to: "draft", rule: "none" };
          x.events = [{ on: "articles.expire", handler: "article_expired" }];
        })
      )
    ).toEqual(["error M061"]);
  });

  it("lets a timer run a transition, archive and restore, and no schedule (M131), nor a timer move (M133)", () => {
    const timed = model(m => {
      m.entities.Article.archive = true;
      m.timers = [
        { on: "Article", at: "published_at", after: "30d", run: "articles.retire" },
        { on: "Article", at: "published_at", after: "60d", run: "articles.archive" },
        { on: "Article", at: "published_at", after: "90d", run: "articles.restore" }
      ];
    });
    expect(validateModel(timed)).toEqual([]);
    const ir = compile(timed);
    expect(ir.timers.map(t => t.run)).toEqual([
      { resource: "articles", action: "retire", handler: "articles_retire" },
      { resource: "articles", action: "archive", handler: "articles_archive" },
      { resource: "articles", action: "restore", handler: "articles_restore" }
    ]);
    const scheduled = model(m => (m.schedules = [{ cron: "0 7 * * *", run: "articles.retire" }]));
    expect(messages(scheduled, "M131")[0]).toContain("is a row action; a schedule has no row");
    const moved = model(m => {
      m.entities.Article.fields.place = { type: "integer", position: { within: "author_id" } };
      m.timers = [{ on: "Article", at: "published_at", run: "articles.move" }];
    });
    expect(messages(moved, "M133")[0]).toContain("needs a place (to) a timer cannot give");
    const other = model(m => {
      m.resources.users = { entity: "User", operations: ["list", "get"] };
      m.timers = [{ on: "Article", at: "published_at", run: "users.retire" }];
    });
    expect(messages(other, "M133")[0]).toContain("is not a row action of a resource over Article");
  });

  it("gives a board over the field its moves, and refuses one over a read-only enum without transitions (M087)", () => {
    const board = (change: (m: Record<string, any>) => void = () => {}) =>
      model(m => {
        m.resources.articles.operations = ["list", "get", "create"];
        m.app = { pages: { desk: { resource: "articles", layout: "board", group_by: "status" } } };
        change(m);
      });
    // No update operation: a drag runs a transition
    expect(validateModel(board())).toEqual([]);
    const bare = board(m => delete m.entities.Article.transitions);
    expect(messages(bare, "M087")[0]).toContain("is read_only and has no transitions");
  });

  it("refuses a public transition on a tenant table under isolation: database (M126)", () => {
    const isolated = (rule: string) =>
      Model.parse({
        osl: "1.0",
        name: "teams",
        entities: {
          User: {
            fields: { id: { type: "uuid", primary: true }, email: { type: "string", required: true, unique: true } }
          },
          Team: { fields: { id: { type: "uuid", primary: true }, name: { type: "string", required: true } } },
          Member: {
            fields: {
              id: { type: "uuid", primary: true },
              team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
              user_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
              role: { type: "enum", enum_values: ["owner", "admin", "member"], required: true, default: "member" }
            },
            unique: [["team_id", "user_id"]]
          },
          Request: {
            fields: {
              id: { type: "uuid", primary: true },
              team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
              status: {
                type: "enum",
                enum_values: ["pending", "approved"],
                required: true,
                default: "pending",
                read_only: true
              }
            },
            rules: { read: "member:team_id", create: "member:team_id", update: "member:team_id" },
            transitions: { field: "status", approve: { from: ["pending"], to: "approved", rule } }
          }
        },
        resources: { requests: { entity: "Request", operations: ["list", "get", "create"] } },
        auth: {
          identity: "User",
          providers: ["credentials"],
          email_field: "email",
          tenancy: {
            entity: "Team",
            membership: "Member",
            role_field: "role",
            creator_role: "owner",
            isolation: "database"
          }
        }
      });
    const errors = (m: Model) => validateModel(m).filter(d => d.level === "error");
    expect(errors(isolated("member:team_id:admin"))).toEqual([]);
    const open = errors(isolated("public"));
    expect(open.map(d => d.code)).toEqual(["M126"]);
    expect(open[0].path).toBe("entities.Request.transitions.approve.rule");
  });
});

describe("transitions in the IR", () => {
  it("compiles the machine and one compiler-written row action per step on every resource over the entity", () => {
    const ir = compile(
      model(m => {
        m.resources.drafts = { entity: "Article", operations: ["list", "get"] };
      })
    );
    const article = ir.entities.find(e => e.name === "Article")!;
    expect(article.transitions!.column).toBe("status");
    expect(article.transitions!.values).toEqual(["draft", "in_review", "published", "retired"]);
    expect(article.transitions!.steps.map(s => [s.name, s.from, s.to, s.stamp, s.rule.kind])).toEqual([
      ["submit", ["draft"], "in_review", undefined, "owner"],
      ["approve", ["in_review"], "published", "published_at", "role"],
      ["reject", ["in_review"], "draft", undefined, "role"],
      ["retire", ["published"], "retired", undefined, "any"]
    ]);
    const actions = ir.actions.filter(a => a.builtin === "transition");
    expect(actions.map(a => `${a.resource}.${a.name}`)).toEqual([
      "articles.submit",
      "articles.approve",
      "articles.reject",
      "articles.retire",
      "drafts.submit",
      "drafts.approve",
      "drafts.reject",
      "drafts.retire"
    ]);
    const approve = actions[1];
    expect(approve).toMatchObject({
      scope: "row",
      method: "POST",
      path: "/api/articles/{id}/approve",
      input: [],
      returns: { kind: "entity" },
      handler: "articles_approve",
      rule: { kind: "role", value: "editor" }
    });
    expect(approve.description).toBe(
      "Moves the row's status from in_review to published and sets published_at. 409 (invalid_transition) when the row is in another state"
    );
    // Without a rule of its own a transition runs under the entity's update rule
    expect(actions[0].rule).toEqual(article.rules.update);
    expect(transitionOf(ir, approve)).toBe(article.transitions!.steps[1]);
    expect(userActions(ir)).toEqual([]);
    expect(statementActions(ir)).toHaveLength(8);
  });

  it("keeps a transition whose rule is none as an action without a route, for a timer", () => {
    const ir = compile(
      model(m => {
        m.entities.Article.transitions.expire = { from: ["in_review"], to: "draft", rule: "none" };
        m.timers = [{ on: "Article", at: "published_at", run: "articles.expire" }];
      })
    );
    const expire = ir.actions.find(a => a.name === "expire")!;
    expect(expire.builtin).toBe("transition");
    expect(expire.rule.kind).toBe("none");
    expect(ir.timers[0].run).toEqual({ resource: "articles", action: "expire", handler: "articles_expire" });
    const paths = Object.keys((openapiDocument(ir) as { paths: Record<string, unknown> }).paths);
    expect(paths).toContain("/api/articles/{id}/approve");
    expect(paths).not.toContain("/api/articles/{id}/expire");
  });

  it("documents each transition: what it moves and the 409", () => {
    const doc = openapiDocument(compile(model())) as {
      paths: Record<string, { post: { summary: string; responses: Record<string, unknown> } }>;
    };
    const submit = doc.paths["/api/articles/{id}/submit"].post;
    expect(submit.summary).toContain("from draft to in_review");
    expect(submit.summary).toContain("409 (invalid_transition)");
    expect(Object.keys(submit.responses)).toEqual(expect.arrayContaining(["200", "401", "403", "404", "409"]));
  });
});

describe("transitions in a diff", () => {
  const apply = (m: Model, yaml: string) => applyDiff(m, parseDiff(fromYaml(yaml))).model;

  it("sets, replaces and removes the block with set_transitions", () => {
    const base = model(m => delete m.entities.Article.transitions);
    const set = apply(
      base,
      `osl: "1.0"
ops:
  - op: set_transitions
    entity: Article
    transitions:
      field: status
      submit: { from: [draft], to: in_review }
`
    );
    expect(validateModel(set)).toEqual([]);
    expect(transitionsOf(set.entities.Article)!.steps.map(s => s.name)).toEqual(["submit"]);
    const replaced = apply(
      set,
      `osl: "1.0"
ops:
  - op: set_transitions
    entity: Article
    transitions:
      field: status
      publish: { from: [draft, in_review], to: published, stamp: published_at }
`
    );
    expect(transitionsOf(replaced.entities.Article)!.steps.map(s => s.name)).toEqual(["publish"]);
    const removed = apply(
      replaced,
      `osl: "1.0"\nops:\n  - { op: set_transitions, entity: Article, transitions: false }\n`
    );
    expect(removed.entities.Article.transitions).toBeUndefined();
    expect(removed.entities.Article.fields.status.read_only).toBe(true);
    expect(() =>
      parseDiff(
        fromYaml(`osl: "1.0"\nops:\n  - { op: set_transitions, entity: Article, transitions: { field: status } }\n`)
      )
    ).toThrow();
  });

  it("follows a renamed field in the block, its stamps and its rules, and refuses to lose one", () => {
    const m = model();
    const renamed = apply(
      m,
      `osl: "1.0"
ops:
  - { op: rename_field, entity: Article, from: status, to: stage }
  - { op: rename_field, entity: Article, from: published_at, to: live_at }
  - { op: rename_field, entity: Article, from: author_id, to: writer_id }
`
    );
    expect(validateModel(renamed)).toEqual([]);
    const machine = transitionsOf(renamed.entities.Article)!;
    expect(machine.field).toBe("stage");
    expect(machine.steps.find(s => s.name === "approve")!.stamp).toBe("live_at");
    expect(machine.steps.find(s => s.name === "retire")!.rule).toBe(
      "role:editor or owner:writer_id when stage = published"
    );
    const remove = (name: string) =>
      apply(m, `osl: "1.0"\nops:\n  - { op: remove_field, entity: Article, name: ${name} }\n`);
    // A rule that names the field is told first; without one, the block is
    expect(() => remove("status")).toThrow(/rule of the transition retire of Article still uses Article.status/);
    const plain = model(x => delete x.entities.Article.transitions.retire);
    expect(() => apply(plain, `osl: "1.0"\nops:\n  - { op: remove_field, entity: Article, name: status }\n`)).toThrow(
      /status is the field of Article's transitions/
    );
    expect(() => remove("published_at")).toThrow(/the transition approve of Article stamps published_at/);
  });

  it("explains the breaking change of a status that became the transitions'", () => {
    const before = model(m => {
      delete m.entities.Article.transitions;
      delete m.entities.Article.fields.status.read_only;
    });
    const diff = parseDiff(
      fromYaml(`osl: "1.0"
ops:
  - op: update_field
    entity: Article
    name: status
    field: { type: enum, enum_values: [draft, in_review, published, retired], required: true, default: draft, read_only: true }
  - op: set_transitions
    entity: Article
    transitions: { field: status, submit: { from: [draft], to: in_review } }
`)
    );
    const after = applyDiff(before, diff).model;
    expect(validateModel(after)).toEqual([]);
    const changes = diffOpenApi(openapiDocument(compile(before)), openapiDocument(compile(after)));
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) expect(explainedBy(change, diff.ops, compile(before))).toBe(true);
    // The op alone accounts for a change on its entity
    expect(explainedBy(changes[0], [diff.ops[1]], compile(before))).toBe(true);
  });
});
