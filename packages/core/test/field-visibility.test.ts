import { describe, expect, it } from "vitest";
import {
  Model,
  anonymousCouldRead,
  applyDiff,
  compile,
  diffOpenApi,
  explainedBy,
  hasFieldRules,
  openapiDocument,
  parseDiff,
  ruleText,
  ruledColumns,
  validateModel
} from "../src/index.js";

/** Teams with projects and tasks: a budget for the team's admins, a phone for its owner, an estimate for the signed in */
function model(change: (m: Record<string, any>) => void = () => {}): Model {
  const raw: Record<string, any> = {
    osl: "1.0",
    name: "desk",
    entities: {
      User: {
        fields: {
          id: { type: "uuid", primary: true },
          email: { type: "string", required: true, unique: true },
          name: { type: "string", required: true },
          role: { type: "enum", enum_values: ["member", "admin"], required: true, default: "member", read_only: true },
          phone: { type: "string", read: "owner:id or role:admin" }
        },
        rules: { read: "public", update: "owner:id", delete: "none" }
      },
      Team: {
        fields: { id: { type: "uuid", primary: true }, name: { type: "string", required: true } },
        rules: { read: "member:id", create: "authenticated", update: "member:id:admin", delete: "member:id:owner" }
      },
      TeamMember: {
        fields: {
          id: { type: "uuid", primary: true },
          team_id: {
            type: "uuid",
            required: true,
            relation: { entity: "Team", reverse: "members", on_delete: "cascade" }
          },
          user_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
          role: { type: "enum", enum_values: ["owner", "admin", "member"], required: true, default: "member" }
        },
        rules: {
          read: "member:team_id",
          create: "member:team_id:admin",
          update: "member:team_id:admin",
          delete: "member:team_id:owner"
        },
        unique: [["team_id", "user_id"]]
      },
      Project: {
        fields: {
          id: { type: "uuid", primary: true },
          team_id: {
            type: "uuid",
            required: true,
            relation: { entity: "Team", reverse: "projects", on_delete: "cascade" }
          },
          name: { type: "string", required: true },
          public: { type: "boolean", required: true, default: false },
          status: { type: "enum", enum_values: ["active", "closed"], required: true, default: "active" },
          created_at: { type: "datetime", required: true, default: "now" },
          budget: { type: "integer", read: "member:team_id:admin" }
        },
        rules: {
          read: "member:team_id",
          create: "member:team_id:admin",
          update: "member:team_id:admin",
          delete: "member:team_id:admin"
        }
      },
      Task: {
        fields: {
          id: { type: "uuid", primary: true },
          project_id: {
            type: "uuid",
            required: true,
            relation: { entity: "Project", reverse: "tasks", on_delete: "cascade" }
          },
          assignee_id: { type: "uuid", relation: { entity: "User", on_delete: "set_null" } },
          title: { type: "string", required: true },
          done: { type: "boolean", required: true, default: false },
          estimate: { type: "integer", read: "owner:assignee_id or public when done = true" }
        },
        rules: {
          read: "public when project_id.public = true or member:project_id.team_id",
          create: "member:project_id.team_id",
          update: "owner:assignee_id",
          delete: "member:project_id.team_id:admin"
        }
      }
    },
    resources: {
      users: { entity: "User", operations: ["list", "get", "update"], update: { fields: ["name", "phone"] } },
      teams: { entity: "Team", operations: ["list", "get", "create", "update", "delete"] },
      members: { entity: "TeamMember", operations: ["list", "get", "create", "update", "delete"] },
      projects: {
        entity: "Project",
        operations: ["list", "get", "create", "update", "delete"],
        list: { filters: ["team_id", "status"] },
        get: { include: ["tasks"] }
      },
      tasks: {
        entity: "Task",
        operations: ["list", "get", "create", "update", "delete"],
        list: { filters: ["project_id"], include: ["project"] },
        create: { fields: ["project_id", "assignee_id", "title"] }
      }
    },
    auth: {
      identity: "User",
      provider: "credentials",
      tenancy: { entity: "Team", membership: "TeamMember", role_field: "role", creator_role: "owner" }
    }
  };
  change(raw);
  return Model.parse(raw);
}

const codes = (m: Model) => validateModel(m).map(d => `${d.level} ${d.code}`);
const messages = (m: Model, code: string) =>
  validateModel(m)
    .filter(d => d.code === code)
    .map(d => d.message);

describe("read on a field in the model", () => {
  it("takes a rule in the entity rules' spelling and compiles it onto the column, as written", () => {
    const m = model();
    expect(validateModel(m)).toEqual([]);
    const ir = compile(m);
    expect(hasFieldRules(ir)).toBe(true);
    const of = (entity: string) =>
      ruledColumns(ir.entities.find(e => e.name === entity)!).map(c => [c.name, ruleText(c.read!)]);
    expect(of("User")).toEqual([["phone", "owner:id or role:admin"]]);
    expect(of("Project")).toEqual([["budget", "member:team_id:admin"]]);
    expect(of("Task")).toEqual([["estimate", "owner:assignee_id or public when done = true"]]);
    expect(of("Team")).toEqual([]);
    // The typed literal of a condition, as an entity rule's
    const estimate = ir.entities.find(e => e.name === "Task")!.columns.find(c => c.name === "estimate")!;
    expect(estimate.read).toEqual({
      kind: "any",
      rules: [
        { kind: "owner", field: "assignee_id" },
        { kind: "public", when: { column: "done", op: "eq", value: true } }
      ]
    });
    expect(anonymousCouldRead(estimate.read!)).toBe(true);
    expect(anonymousCouldRead(ir.entities[0].columns.find(c => c.name === "phone")!.read!)).toBe(false);
    // Written back, the model parses to itself; a model without one compiles no rule at all
    expect(Model.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
    const plain = compile(model(x => delete x.entities.User.fields.phone.read));
    expect(ruledColumns(plain.entities[0])).toEqual([]);
    expect(() => model(x => (x.entities.User.fields.phone.read = "owner"))).toThrow();
  });

  it("checks the rule as an entity's is: the fields it names, the role, what auth it needs", () => {
    expect(codes(model(m => (m.entities.User.fields.phone.read = "owner:nobody")))).toEqual(["error M020"]);
    expect(codes(model(m => (m.entities.Project.fields.budget.read = "member:team_id:boss")))).toEqual(["error M026"]);
    expect(codes(model(m => (m.entities.Project.fields.budget.read = "owner:name")))).toEqual(["error M022"]);
    expect(codes(model(m => (m.entities.Task.fields.estimate.read = "public when done = maybe")))).toEqual([
      "error M033"
    ]);
  });

  it("refuses read on a field that never leaves, names the row or points at another (M170)", () => {
    const hidden = model(m => (m.entities.User.fields.secret = { type: "string", hidden: true, read: "role:admin" }));
    expect(messages(hidden, "M170")[0]).toContain("User.secret is hidden");
    expect(
      messages(
        model(m => (m.entities.Team.fields.id.read = "member:id")),
        "M170"
      )[0]
    ).toContain("is the primary key");
    const relation = model(m => (m.entities.Task.fields.assignee_id.read = "authenticated"));
    expect(messages(relation, "M170")[0]).toContain("an include, a reverse relation and a filter by it");
  });

  it("holds the rule to the row and the caller: no path, no membership relation, no condition through a relation (M171)", () => {
    const path = model(m => (m.entities.Task.fields.estimate.read = "member:project_id.team_id:admin"));
    expect(codes(path)).toEqual(["error M171"]);
    expect(messages(path, "M171")[0]).toContain("a path through a relation is refused here");
    expect(messages(path, "M171")[0]).toContain("its tenant relation");
    expect(codes(model(m => (m.entities.Task.fields.estimate.read = "owner:project_id.team_id")))).toContain(
      "error M171"
    );
    const membership = model(m => (m.entities.Team.fields.name.read = "member:members"));
    expect(messages(membership, "M171")[0]).toContain("a membership relation is a lookup");
    const condition = model(
      m => (m.entities.Task.fields.estimate.read = "authenticated when project_id.public = true")
    );
    expect(messages(condition, "M171")[0]).toContain("a condition through a relation is refused here");
  });

  it("refuses to narrow, order, search or group a list by a field with a read rule (M172)", () => {
    const filtered = model(m => m.resources.projects.list.filters.push("budget"));
    expect(codes(filtered)).toEqual(["error M172"]);
    expect(messages(filtered, "M172")[0]).toContain("which rows a filter answers would tell its value");
    expect(codes(model(m => (m.resources.projects.list.sortable = ["budget"])))).toEqual(["error M172"]);
    expect(codes(model(m => (m.resources.projects.list.order = [["budget", "desc"]])))).toEqual(["error M172"]);
    expect(codes(model(m => (m.resources.users.list = { search: ["phone"] })))).toEqual(["error M172"]);
    const board = model(m => {
      m.entities.Project.fields.status.read = "member:team_id:admin";
      m.resources.projects.list.filters = ["team_id"];
      m.app = { title: "Desk", pages: { projects: { resource: "projects", layout: "board", group_by: "status" } } };
    });
    expect(messages(board, "M172")[0]).toContain("the column a card sits in would tell its value");
  });

  it("orders a list by another field when created_at has a read rule, and names a row by a field everyone reads", () => {
    const ir = compile(
      model(m => {
        m.entities.Project.fields.created_at.read = "member:team_id:admin";
        m.entities.Project.fields.name.read = "member:team_id:admin";
      })
    );
    const projects = ir.resources.find(r => r.name === "projects")!;
    expect(projects.operations.find(o => o.kind === "list")).toMatchObject({ order: [["id", "asc"]] });
    expect(ir.entities.find(e => e.name === "Project")!.display).toBe("id");
  });

  it("refuses read on a field the compiler shows whatever the rule says (M173)", () => {
    const position = model(m => {
      m.entities.Task.fields.position = { type: "integer", position: { within: "project_id" }, read: "authenticated" };
    });
    expect(messages(position, "M173")[0]).toContain("the order of every list of Task shows it");
    const archive = model(m => {
      m.entities.Task.fields.archived_at = { type: "datetime", read_only: true, read: "authenticated" };
      m.entities.Task.archive = true;
    });
    expect(messages(archive, "M173")[0]).toContain("the lists already tell every reader which rows are archived");
    const machine = model(m => {
      m.entities.Project.fields.status = {
        type: "enum",
        enum_values: ["active", "closed"],
        required: true,
        default: "active",
        read_only: true,
        read: "member:team_id:admin"
      };
      m.entities.Project.fields.closed_at = { type: "datetime", read_only: true, read: "member:team_id:admin" };
      m.entities.Project.transitions = {
        field: "status",
        close: { from: ["active"], to: "closed", stamp: "closed_at" }
      };
      m.resources.projects.list.filters = ["team_id"];
    });
    // The state leaks through 409 against 200; the stamp does not, and may be hidden
    expect(codes(machine)).toEqual(["error M173"]);
    expect(messages(machine, "M173")[0]).toContain("a transition answers 409 from a state it does not start in");
  });

  it("lets the server read a field with a read rule: a rule's when, a count's where, a timer's when", () => {
    const m = model(x => {
      x.entities.Task.rules.update = "owner:assignee_id when estimate != null";
      x.entities.Project.fields.costed = { type: "integer", count_of: "tasks", where: "estimate != null" };
      x.entities.Project.fields.costed.read = "member:team_id:admin";
    });
    expect(validateModel(m)).toEqual([]);
  });

  it("warns when a writer may not read what they wrote (M174) and when a hidden value is unique (M175)", () => {
    const loose = model(m => (m.entities.Project.rules.update = "member:team_id"));
    expect(codes(loose)).toEqual(["warning M174"]);
    expect(messages(loose, "M174")[0]).toContain(
      '"member:team_id" lets a caller change it through projects.update whom read "member:team_id:admin" may refuse'
    );
    // The same readers as writers, a field out of the operation's list and a read_only field need no warning
    expect(codes(model(m => (m.resources.users.update.fields = ["name"])))).toEqual([]);
    const listed = model(m => {
      m.entities.Project.rules.update = "member:team_id";
      m.entities.Project.rules.create = "member:team_id";
      m.resources.projects.create = { fields: ["team_id", "name"] };
      m.resources.projects.update = { fields: ["name"] };
    });
    expect(codes(listed)).toEqual([]);
    const unique = model(m => (m.entities.User.fields.phone.unique = true));
    expect(codes(unique)).toEqual(["warning M175"]);
    expect(messages(unique, "M175")[0]).toContain("a write that repeats a value answers 409");
  });

  it("follows a rename, and lets a field with a read rule go", () => {
    const renamed = applyDiff(
      model(),
      parseDiff({
        osl: "1.0",
        summary: "x",
        ops: [
          { op: "rename_field", entity: "Task", from: "done", to: "finished" },
          { op: "rename_field", entity: "Task", from: "assignee_id", to: "owner_id" }
        ]
      })
    ).model;
    expect(renamed.entities.Task.fields.estimate.read).toBe("owner:owner_id or public when finished = true");
    const blocked = () =>
      applyDiff(
        model(),
        parseDiff({ osl: "1.0", summary: "x", ops: [{ op: "remove_field", entity: "Task", name: "done" }] })
      );
    expect(blocked).toThrow(/read rule of Task.estimate still uses Task.done/);
    const removed = applyDiff(
      model(m => (m.resources.users.update.fields = ["name"])),
      parseDiff({ osl: "1.0", summary: "x", ops: [{ op: "remove_field", entity: "User", name: "phone" }] })
    ).model;
    expect(removed.entities.User.fields.phone).toBeUndefined();
  });
});

describe("read on a field under isolation: database", () => {
  const isolated = (change: (m: Record<string, any>) => void = () => {}) =>
    model(m => {
      m.auth.tenancy.isolation = "database";
      m.entities.User.rules.read = "authenticated";
      change(m);
    });

  it("compiles a field rule as written: the membership B1 adds to an entity rule is not added to it", () => {
    const m = isolated(x => (x.entities.Project.fields.budget.read = "role:admin or member:team_id:admin"));
    const ir = compile(m);
    const project = ir.entities.find(e => e.name === "Project")!;
    expect(ruleText(project.columns.find(c => c.name === "budget")!.read!)).toBe("role:admin or member:team_id:admin");
    // The entity rule beside it is narrowed where it needs a session
    expect(ruleText(project.rules.read)).toBe("member:team_id");
    expect(codes(m).filter(c => c.endsWith("M176"))).toEqual([]);
  });

  it("warns where a public row lets a signed-in caller who is not a member read the field (M176)", () => {
    const open = isolated(x => (x.entities.Task.fields.estimate.read = "authenticated"));
    const warnings = messages(open, "M176");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Task is a tenant table whose read rule shows some rows to everyone");
    expect(warnings[0]).toContain('"authenticated" lets a signed-in caller who is not a member of the row\'s Team');
    // An owner is named by the row itself; a public alternative is everyone who reads the row
    expect(messages(isolated(), "M176")).toEqual([]);
    // A tenant table nobody outside reads needs no warning
    expect(
      messages(
        isolated(x => (x.entities.Project.fields.budget.read = "authenticated")),
        "M176"
      )
    ).toEqual([]);
  });
});

describe("read on a field in the contract", () => {
  it("leaves the property out of required, says for whom it is there, and answers fields beside the session's user", () => {
    const doc = openapiDocument(compile(model())) as any;
    const project = doc.components.schemas.Project;
    expect(project.required).not.toContain("budget");
    expect(project.required).toContain("name");
    expect(project.properties.budget.description).toBe(
      "Present only for a caller this rule allows on the row: member:team_id:admin."
    );
    const me = doc.paths["/api/auth/me"].get.responses["200"].content["application/json"].schema;
    expect(me.required).toEqual(["data", "fields"]);
    expect(me.properties.fields.properties.projects).toEqual({
      type: "object",
      required: ["budget"],
      properties: { budget: { type: "boolean" } }
    });
    expect(Object.keys(me.properties.fields.properties)).toEqual(["users", "projects", "tasks"]);
    const plain = openapiDocument(
      compile(
        model(m => {
          for (const e of Object.values<any>(m.entities)) for (const f of Object.values<any>(e.fields)) delete f.read;
        })
      )
    ) as any;
    expect(plain.paths["/api/auth/me"].get.responses["200"].content["application/json"].schema.required).toEqual([
      "data"
    ]);
  });

  it("reports a field that gains a read rule as a breaking change its update_field explains", () => {
    const before = model(m => delete m.entities.Project.fields.budget.read);
    const ops = parseDiff({
      osl: "1.0",
      summary: "x",
      ops: [
        {
          op: "update_field",
          entity: "Project",
          name: "budget",
          field: { type: "integer", read: "member:team_id:admin" }
        }
      ]
    }).ops;
    const after = applyDiff(before, { osl: "1.0", summary: "x", ops }).model;
    const changes = diffOpenApi(openapiDocument(compile(before)), openapiDocument(compile(after)));
    expect(changes).toEqual([
      {
        kind: "optional_property",
        schema: "Project",
        property: "budget",
        detail: "the schema Project: budget may now be absent"
      }
    ]);
    expect(explainedBy(changes[0], ops, compile(before))).toBe(true);
    expect(explainedBy(changes[0], [], compile(before))).toBe(false);
    // The other way is no break: a client that coped without the field copes with it
    expect(diffOpenApi(openapiDocument(compile(after)), openapiDocument(compile(before)))).toEqual([]);
  });
});

describe("expect.absent in a scenario", () => {
  it("takes dotted paths beside body and keeps them in the IR", () => {
    const m = model(x => {
      x.examples = {
        actors: { ann: { email: "ann@example.com", password: "ann-pass-1", name: "Ann" } },
        scenarios: [
          {
            name: "a member reads a project",
            steps: [
              {
                as: "ann",
                op: "projects.list",
                expect: { status: 200, body: { data: [] }, absent: ["data.budget", "data.tasks.estimate"] }
              }
            ]
          }
        ]
      };
    });
    expect(validateModel(m)).toEqual([]);
    expect(compile(m).examples.scenarios[0].steps[0].expect).toEqual({
      status: 200,
      body: { data: [] },
      absent: ["data.budget", "data.tasks.estimate"]
    });
    const bad = (absent: unknown) =>
      model(x => {
        x.examples = {
          scenarios: [{ name: "s", steps: [{ op: "projects.list", expect: { status: 200, absent } }] }]
        };
      });
    expect(() => bad(["data..budget"])).toThrow();
    expect(() => bad([])).toThrow();
    expect(() => bad("data.budget")).toThrow();
  });
});
