import { describe, expect, it } from "vitest";
import {
  Model,
  applyDiff,
  archiveNameClash,
  archiveOf,
  compile,
  countLink,
  countObjects,
  databaseObjects,
  isArchiveAction,
  isolationDrift,
  openapiDocument,
  parseDiff,
  planMigration,
  renderPostgres,
  resolveStepOp,
  ruleText,
  userActions,
  validateModel
} from "../src/index.js";

/** Projects that archive and count their tasks, tasks in order within their project, labels on tasks through a junction */
function model(change: (m: Record<string, any>) => void = () => {}): Model {
  const raw: Record<string, any> = {
    osl: "1.0",
    name: "tracker",
    entities: {
      User: {
        fields: {
          id: { type: "uuid", primary: true },
          email: { type: "string", required: true, unique: true },
          role: { type: "enum", enum_values: ["member", "admin"], required: true, default: "member" }
        },
        rules: { read: "public", update: "owner:id", delete: "none" }
      },
      Project: {
        archive: { rule: "role:admin" },
        fields: {
          id: { type: "uuid", primary: true },
          owner_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
          name: { type: "string", required: true },
          task_count: { type: "integer", count_of: "tasks" },
          open_tasks: { type: "integer", count_of: "tasks", where: "done = false and archived_at = null" }
        },
        rules: { read: "public", create: "owner:owner_id", update: "owner:owner_id", delete: "owner:owner_id" }
      },
      Task: {
        archive: true,
        fields: {
          id: { type: "uuid", primary: true },
          project_id: {
            type: "uuid",
            required: true,
            relation: { entity: "Project", name: "project", reverse: "tasks", on_delete: "cascade" }
          },
          assignee_id: { type: "uuid", relation: { entity: "User", reverse: "assigned", on_delete: "set_null" } },
          title: { type: "string", required: true },
          done: { type: "boolean", required: true, default: false }
        },
        rules: {
          read: "public",
          create: "owner:project_id.owner_id",
          update: "owner:project_id.owner_id",
          delete: "owner:project_id.owner_id"
        }
      }
    },
    resources: {
      projects: { entity: "Project", operations: ["list", "get", "create", "update", "delete"] },
      tasks: {
        entity: "Task",
        operations: ["list", "get", "create", "update", "delete"],
        list: { filters: ["project_id", "done"] }
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

describe("archive in the model", () => {
  it("adds the field the model does not spell, read-only and nullable, and names it", () => {
    const m = model();
    expect(validateModel(m)).toEqual([]);
    expect(m.entities.Task.fields.archived_at).toEqual({ type: "datetime", read_only: true });
    expect(archiveOf(m.entities.Task)).toEqual({ field: "archived_at" });
    expect(archiveOf(m.entities.Project)).toEqual({ field: "archived_at", rule: "role:admin" });
    expect(archiveOf(m.entities.User)).toBeUndefined();
    // Written back, the model parses to itself
    expect(Model.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it("uses a field the entity names, when it is a server-owned nullable datetime (M150)", () => {
    const named = model(m => {
      m.entities.Task.archive = { field: "shelved_at" };
      m.entities.Task.fields.shelved_at = { type: "datetime", read_only: true };
      m.entities.Project.fields.open_tasks.where = "done = false and shelved_at = null";
    });
    expect(validateModel(named)).toEqual([]);
    expect(named.entities.Task.fields.archived_at).toBeUndefined();
    expect(compile(named).entities.find(e => e.name === "Task")!.archive!.column).toBe("shelved_at");
    for (const field of [
      { type: "datetime" },
      { type: "datetime", read_only: true, required: true, default: "now" },
      { type: "boolean", read_only: true }
    ])
      expect(
        codes(
          model(m => {
            m.entities.Task.archive = { field: "shelved_at" };
            m.entities.Task.fields.shelved_at = field;
            m.entities.Project.fields.open_tasks.where = "done = false";
          })
        )
      ).toContain("error M150");
  });

  it("keeps archive and restore for the compiler, in words a transition can be told too (M151)", () => {
    const clash = model(m => {
      m.resources.tasks.actions = { archive: { rule: "authenticated" }, restore: {} };
    });
    expect(messages(clash, "M151")).toHaveLength(2);
    expect(messages(clash, "M151")[0]).toBe(archiveNameClash("tasks", "Task", "archived_at", "action", "archive"));
    expect(archiveNameClash("tasks", "Task", "archived_at", "transition", "archive")).toContain(
      "Give your transition another name than archive"
    );
    // Without archive: the names are the model's
    expect(
      codes(
        model(m => {
          delete m.entities.Task.archive;
          m.entities.Project.fields.open_tasks.where = "done = false";
          m.resources.tasks.actions = { archive: {} };
        })
      )
    ).toEqual([]);
  });

  it("warns on the identity (M152) and refuses a list filter named archived (M157)", () => {
    expect(codes(model(m => (m.entities.User.archive = true)))).toEqual(["warning M152"]);
    expect(
      codes(
        model(m => {
          m.entities.Task.fields.archived = { type: "boolean" };
          m.resources.tasks.list.filters.push("archived");
        })
      )
    ).toEqual(["error M157"]);
  });

  it("resolves the two actions as steps and events, and not under a rule of none", () => {
    const m = model();
    expect(resolveStepOp(m, "tasks.archive")).toEqual({ kind: "action", resource: "tasks", action: "archive" });
    expect(resolveStepOp(m, "tasks.restore").kind).toBe("action");
    expect(resolveStepOp(m, "users.archive").kind).toBe("unknown");
    expect(isArchiveAction(m, m.resources.tasks, "archive")).toBe(true);
    const closed = model(m => (m.entities.Task.rules.update = "none"));
    expect(isArchiveAction(closed, closed.resources.tasks, "archive")).toBe(false);
    const own = model(m => {
      m.entities.Task.rules.update = "none";
      m.entities.Task.archive = { rule: "role:admin" };
    });
    expect(isArchiveAction(own, own.resources.tasks, "restore")).toBe(true);
    expect(codes(model(m => (m.events = [{ on: "tasks.archive", handler: "task_archived" }])))).toEqual([]);
    expect(codes(model(m => (m.events = [{ on: "users.archive", handler: "user_archived" }])))).toEqual(["error M061"]);
  });

  it("tells a timer that runs archive what to run instead (M133)", () => {
    const timed = model(m => {
      m.entities.Task.fields.due_at = { type: "datetime" };
      m.timers = [{ on: "Task", at: "due_at", run: "tasks.archive" }];
    });
    expect(messages(timed, "M133")[0]).toContain("declare a row action whose handler sets archived_at");
  });

  it("takes archived as a page or tile filter of an archiving entity only", () => {
    const page = (resource: string) =>
      model(m => {
        m.resources.users = { entity: "User", operations: ["list", "get"] };
        m.app = { pages: { shelf: { kind: "resource", resource, filter: { archived: true } } } };
      });
    expect(codes(page("tasks"))).toEqual([]);
    expect(codes(page("users"))).toContain("error M089");
  });
});

describe("count_of in the model", () => {
  it("resolves the reverse relation and the conditions", () => {
    const m = model();
    expect(countLink(m, "Project", m.entities.Project.fields.task_count)).toEqual({
      entity: "Task",
      field: "project_id",
      where: []
    });
    expect(countLink(m, "Project", m.entities.Project.fields.open_tasks)).toEqual({
      entity: "Task",
      field: "project_id",
      where: [
        { field: "done", op: "=", value: "false" },
        { field: "archived_at", op: "=", value: "null" }
      ]
    });
  });

  it("refuses a count that is not a plain integer, and a where without one", () => {
    const parse = (field: Record<string, unknown>) =>
      Model.safeParse({
        osl: "1.0",
        name: "x",
        entities: { A: { fields: { id: { type: "uuid", primary: true }, n: field } } }
      }).success;
    expect(parse({ type: "integer", count_of: "rows" })).toBe(true);
    expect(parse({ type: "string", count_of: "rows" })).toBe(false);
    expect(parse({ type: "integer", count_of: "rows", default: 0 })).toBe(false);
    expect(parse({ type: "integer", count_of: "rows", unique: true })).toBe(false);
    expect(parse({ type: "integer", where: "done = false" })).toBe(false);
    expect(parse({ type: "integer", count_of: "rows", where: "done = false or done = true" })).toBe(false);
    expect(parse({ type: "integer", count_of: "rows", where: "project_id.public = true" })).toBe(false);
  });

  it("refuses a name that is not a reverse relation to count (M153)", () => {
    expect(
      messages(
        model(m => (m.entities.Project.fields.task_count.count_of = "notes")),
        "M153"
      )[0]
    ).toContain("notes is not a reverse relation of Project");
    const oneToOne = model(m => (m.entities.Task.fields.project_id.relation.kind = "one_to_one"));
    expect(messages(oneToOne, "M153")[0]).toContain("at most one row to count");
    const through = model(m => {
      m.entities.Tag = { fields: { id: { type: "uuid", primary: true }, name: { type: "string", required: true } } };
      m.entities.TaskTag = {
        fields: {
          id: { type: "uuid", primary: true },
          task_id: { type: "uuid", required: true, relation: { entity: "Task", on_delete: "cascade" } },
          tag_id: { type: "uuid", required: true, relation: { entity: "Tag", on_delete: "cascade" } }
        }
      };
      m.entities.Task.relations = { tags: { through: "TaskTag" } };
      m.entities.Task.fields.tag_count = { type: "integer", count_of: "tags" };
    });
    expect(messages(through, "M153")[0]).toContain("count the junction's rows instead");
  });

  it("checks every condition against the counted entity (M154) and says what read_only: false means (M155)", () => {
    expect(
      messages(
        model(m => (m.entities.Project.fields.open_tasks.where = "closed = false")),
        "M154"
      )[0]
    ).toContain("closed, which is not a field of Task");
    expect(
      messages(
        model(m => (m.entities.Project.fields.open_tasks.where = "done = maybe")),
        "M154"
      )[0]
    ).toContain("must be true or false");
    expect(
      messages(
        model(m => (m.entities.Project.fields.open_tasks.where = "title = null")),
        "M154"
      )[0]
    ).toContain("never null");
    expect(codes(model(m => (m.entities.Project.fields.task_count.read_only = false)))).toEqual(["warning M155"]);
  });

  it("keeps a count out of what a client writes (M064)", () => {
    const written = model(m => (m.resources.projects.update = { fields: ["name", "task_count"] }));
    expect(messages(written, "M064")[0]).toContain("is a count: the database keeps it");
  });
});

describe("the compiled archive and counts", () => {
  const ir = compile(model());
  const project = ir.entities.find(e => e.name === "Project")!;
  const task = ir.entities.find(e => e.name === "Task")!;

  it("makes the count a column nobody writes and resolves what it counts", () => {
    expect(project.columns.find(c => c.name === "task_count")).toMatchObject({
      nullable: false,
      readOnly: true,
      count: true,
      default: { kind: "literal", value: 0 }
    });
    expect(project.counts).toEqual([
      {
        column: "task_count",
        relation: "tasks",
        entity: "Task",
        table: "tasks",
        fk: "project_id",
        key: "id",
        where: [],
        function: "osl_count_projects_task_count",
        trigger: "osl_count_projects_task_count"
      },
      {
        column: "open_tasks",
        relation: "tasks",
        entity: "Task",
        table: "tasks",
        fk: "project_id",
        key: "id",
        where: [
          { column: "done", op: "eq", value: false },
          { column: "archived_at", op: "eq", value: null }
        ],
        function: "osl_count_projects_open_tasks",
        trigger: "osl_count_projects_open_tasks"
      }
    ]);
    const projects = ir.resources.find(r => r.name === "projects")!;
    const create = projects.operations.find(o => o.kind === "create") as { fields: string[] };
    const update = projects.operations.find(o => o.kind === "update") as { fields: string[] };
    expect(create.fields).toEqual(["name"]);
    expect(update.fields).toEqual(["name"]);
    expect(projects.outputFields).toContain("open_tasks");
  });

  it("adds archive and restore under the update rule or the archive's own, as actions no handler answers", () => {
    expect(task.archive).toEqual({ column: "archived_at", rule: task.rules.update });
    expect(ruleText(project.archive!.rule)).toBe("role:admin");
    const builtin = ir.actions.filter(a => a.builtin).map(a => `${a.resource}.${a.name} ${a.method} ${a.path}`);
    expect(builtin).toEqual([
      "projects.archive POST /api/projects/{id}/archive",
      "projects.restore POST /api/projects/{id}/restore",
      "tasks.archive POST /api/tasks/{id}/archive",
      "tasks.restore POST /api/tasks/{id}/restore"
    ]);
    const archive = ir.actions.find(a => a.resource === "projects" && a.name === "archive")!;
    expect(archive).toMatchObject({ scope: "row", input: [], returns: { kind: "entity" }, builtin: "archive" });
    expect(ruleText(archive.rule)).toBe("role:admin");
    expect(userActions(ir)).toEqual([]);
    // No actions where the rule is none
    const closed = compile(model(m => (m.entities.Task.rules.update = "none")));
    expect(closed.actions.filter(a => a.resource === "tasks")).toEqual([]);
    expect(closed.entities.find(e => e.name === "Task")!.archive!.column).toBe("archived_at");
  });

  it("documents the list parameter and the two actions", () => {
    const doc = openapiDocument(ir) as { paths: Record<string, any> };
    const parameters = doc.paths["/api/tasks"].get.parameters as { name: string; schema: unknown }[];
    expect(parameters.find(p => p.name === "archived")).toMatchObject({ in: "query", schema: { type: "boolean" } });
    expect((doc.paths["/api/projects"].get.parameters as { name: string }[]).some(p => p.name === "archived")).toBe(
      true
    );
    expect(doc.paths["/api/tasks/{id}/archive"].post.responses["409"]).toBeDefined();
    expect(doc.paths["/api/tasks/{id}/restore"].post).toBeDefined();
  });

  it("compiles an event on archive like any action's", () => {
    const withEvent = compile(model(m => (m.events = [{ on: "tasks.archive", handler: "task_archived" }])));
    expect(withEvent.events).toEqual([
      {
        name: "tasks.archive",
        handler: "task_archived",
        delivery: "inline",
        kind: "action",
        actionName: "archive",
        resource: "tasks",
        entity: "Task"
      }
    ]);
  });
});

describe("the database side of a count", () => {
  it("makes one function and four statement triggers per count, on the counted table", () => {
    const objects = countObjects(compile(model()));
    expect(objects.map(o => `${o.kind} ${o.table ? `${o.table}.` : ""}${o.name}`)).toEqual([
      "function osl_count_projects_task_count",
      "trigger tasks.osl_count_projects_task_count_ins",
      "trigger tasks.osl_count_projects_task_count_del",
      "trigger tasks.osl_count_projects_task_count_upd",
      "trigger tasks.osl_count_projects_task_count_trn",
      "function osl_count_projects_open_tasks",
      "trigger tasks.osl_count_projects_open_tasks_ins",
      "trigger tasks.osl_count_projects_open_tasks_del",
      "trigger tasks.osl_count_projects_open_tasks_upd",
      "trigger tasks.osl_count_projects_open_tasks_trn"
    ]);
    const open = objects[5];
    // The conditions as SQL: a null literal tests for null
    expect(open.body!.source).toContain(
      `FROM osl_new WHERE "project_id" IS NOT NULL AND "done" = false AND "archived_at" IS NULL`
    );
    // Parents in key order, each written once with what the statement did to it
    expect(open.body!.source).toContain(`GROUP BY "project_id" ORDER BY "project_id"`);
    expect(open.body!.source).toContain(
      `UPDATE "projects" SET "open_tasks" = "open_tasks" + osl_delta.n WHERE "id" = osl_delta.parent;`
    );
    expect(open.body!.definer).toBe(false);
    expect(objects[3].create[0]).toBe(
      `CREATE TRIGGER "osl_count_projects_task_count_upd" AFTER UPDATE ON "tasks" REFERENCING OLD TABLE AS osl_old NEW TABLE AS osl_new FOR EACH STATEMENT EXECUTE FUNCTION "osl_count_projects_task_count"();`
    );
    expect(databaseObjects(compile(model())).slice(-objects.length)).toEqual(objects);
  });

  it("takes an ordered parent before an append, after the rows the new row points at", () => {
    const ordered = compile(
      model(m => (m.entities.Task.fields.position = { type: "integer", position: { within: "project_id" } }))
    );
    expect(ordered.entities.find(e => e.name === "Project")!.counts!.map(c => c.hold)).toEqual([
      "osl_count_hold_tasks",
      "osl_count_hold_tasks"
    ]);
    const objects = countObjects(ordered);
    // One hold for the table, however many counts ride on its order
    const holds = objects.filter(o => o.name === "osl_count_hold_tasks" || o.name === "osl_count_hold");
    expect(holds.map(o => o.kind)).toEqual(["function", "trigger"]);
    const source = holds[0].body!.source;
    const keys = source.indexOf(`PERFORM 1 FROM "users" WHERE "id" = NEW."assignee_id" FOR KEY SHARE;`);
    const parent = source.indexOf(`PERFORM "osl_hold_tasks"(NEW."project_id");`);
    expect(keys).toBeGreaterThan(0);
    expect(parent).toBeGreaterThan(keys);
    // By name it fires before the order's own trigger on the same table
    expect(holds[1].create[0]).toContain(`CREATE TRIGGER "osl_count_hold" BEFORE INSERT ON "tasks" FOR EACH ROW`);
    expect("osl_count_hold" < "osl_order_assign").toBe(true);
    expect(holds[1].uses).toContain("function:osl_hold_tasks");
    // A count over another relation than the one the rows are ordered within takes no hold
    const other = compile(
      model(m => {
        m.entities.Task.fields.position = { type: "integer", position: { within: "project_id" } };
        m.entities.User.fields.assigned_count = { type: "integer", count_of: "assigned" };
        delete m.entities.Project.fields.task_count;
        delete m.entities.Project.fields.open_tasks;
      })
    );
    expect(other.entities.find(e => e.name === "User")!.counts![0].hold).toBeUndefined();
    expect(countObjects(other).some(o => o.name === "osl_count_hold")).toBe(false);
  });

  it("creates them with the table, and counts the rows of a table that gains a count", () => {
    const before = compile(
      model(m => {
        delete m.entities.Project.fields.task_count;
        delete m.entities.Project.fields.open_tasks;
      })
    );
    const after = compile(model());
    const fresh = planMigration(null, after);
    expect(fresh.steps.some(s => s.kind === "backfill_count")).toBe(false);
    const plan = planMigration(before, after);
    expect(plan.steps.map(s => s.kind)).toEqual([
      "add_column",
      "add_column",
      "backfill_count",
      "backfill_count",
      ...Array.from({ length: 10 }, () => "sql")
    ]);
    expect(plan.rewrites.map(s => s.kind)).toEqual(["backfill_count", "backfill_count"]);
    const sql = renderPostgres(plan);
    expect(sql).toContain(`ALTER TABLE "projects" ADD COLUMN "task_count" integer NOT NULL DEFAULT 0;`);
    expect(sql).toContain(
      `UPDATE "projects" AS p SET "open_tasks" = (SELECT count(*) FROM "tasks" AS c WHERE c."project_id" = p."id" AND c."done" = false AND c."archived_at" IS NULL);`
    );
    // And the way back: the triggers and functions go before the columns
    const back = planMigration(after, before);
    expect(back.steps.map(s => s.kind)).toEqual([
      ...Array.from({ length: 10 }, () => "sql"),
      "drop_column",
      "drop_column"
    ]);
  });

  it("counts again when the condition changes, and not when a field it names is renamed", () => {
    const base = compile(model());
    const changed = compile(model(m => (m.entities.Project.fields.open_tasks.where = "done = false")));
    const plan = planMigration(base, changed);
    expect(plan.steps.filter(s => s.kind === "backfill_count").map(s => (s as { column: string }).column)).toEqual([
      "open_tasks"
    ]);
    // The function is dropped and made again around it, with its triggers
    expect(plan.steps.filter(s => s.kind === "sql").map(s => (s as { about: string }).about)).toEqual([
      "drop trigger osl_count_projects_open_tasks_trn",
      "drop trigger osl_count_projects_open_tasks_upd",
      "drop trigger osl_count_projects_open_tasks_del",
      "drop trigger osl_count_projects_open_tasks_ins",
      "drop function osl_count_projects_open_tasks",
      "function osl_count_projects_open_tasks",
      "trigger osl_count_projects_open_tasks_ins",
      "trigger osl_count_projects_open_tasks_del",
      "trigger osl_count_projects_open_tasks_upd",
      "trigger osl_count_projects_open_tasks_trn"
    ]);
    const renamed = applyDiff(
      model(),
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Task", from: "done", to: "finished" }] })
    );
    expect(renamed.model.entities.Project.fields.open_tasks.where).toBe("finished = false and archived_at = null");
    const follow = planMigration(base, compile(renamed.model), renamed.renames);
    expect(follow.steps.some(s => s.kind === "backfill_count")).toBe(false);
    expect(follow.steps.some(s => s.kind === "rename_column")).toBe(true);
  });

  it("is compared by the drift check: a missing trigger, a changed function", () => {
    const ir = compile(model());
    const objects = countObjects(ir);
    const live = {
      secured: [],
      policies: [],
      functions: objects
        .filter(o => o.kind === "function")
        .map(o => ({ name: o.name, definer: false, source: o.body!.source })),
      triggers: objects.filter(o => o.kind === "trigger").map(o => ({ table: o.table!, name: o.name }))
    };
    expect(isolationDrift(ir, live)).toEqual([]);
    const broken = {
      ...live,
      functions: live.functions.map((f, i) =>
        i === 0 ? { ...f, source: f.source.replace("+ osl_delta.n", "+ 1") } : f
      ),
      triggers: live.triggers.slice(1)
    };
    expect(isolationDrift(ir, broken).map(d => `${d.kind} ${d.name}`)).toEqual([
      "function osl_count_projects_task_count",
      "missing_trigger osl_count_projects_task_count_ins"
    ]);
  });
});

describe("the ops that keep archive and counts", () => {
  const apply = (m: Model, ops: unknown[]) => applyDiff(m, parseDiff({ osl: "1.0", ops }));

  it("sets and ends an entity's archive, adding the field once and leaving it when the archive ends", () => {
    const plain = model(m => {
      delete m.entities.Task.archive;
      m.entities.Project.fields.open_tasks.where = "done = false";
    });
    expect(plain.entities.Task.fields.archived_at).toBeUndefined();
    const set = apply(plain, [{ op: "set_archive", entity: "Task", archive: { rule: "role:admin" } }]).model;
    expect(set.entities.Task.archive).toEqual({ rule: "role:admin" });
    expect(set.entities.Task.fields.archived_at).toEqual({ type: "datetime", read_only: true });
    expect(validateModel(set)).toEqual([]);
    const ended = apply(set, [{ op: "set_archive", entity: "Task", archive: false }]).model;
    expect(ended.entities.Task.archive).toBeUndefined();
    expect(ended.entities.Task.fields.archived_at).toEqual({ type: "datetime", read_only: true });
    expect(compile(ended).actions).toEqual(compile(plain).actions);
    // An entity added with the key gets the field the same way
    const added = apply(plain, [
      { op: "add_entity", name: "Note", entity: { archive: true, fields: { id: { type: "uuid", primary: true } } } }
    ]).model;
    expect(added.entities.Note.fields.archived_at).toEqual({ type: "datetime", read_only: true });
  });

  it("follows a renamed archive field and refuses to remove what an archive or a count stands on", () => {
    const m = model();
    const renamed = apply(m, [{ op: "rename_field", entity: "Project", from: "archived_at", to: "shelved_at" }]).model;
    expect(renamed.entities.Project.archive).toEqual({ rule: "role:admin", field: "shelved_at" });
    expect(validateModel(renamed)).toEqual([]);
    const task = apply(m, [{ op: "rename_field", entity: "Task", from: "archived_at", to: "shelved_at" }]).model;
    expect(task.entities.Task.archive).toEqual({ field: "shelved_at" });
    expect(task.entities.Project.fields.open_tasks.where).toBe("done = false and shelved_at = null");
    expect(() => apply(m, [{ op: "remove_field", entity: "Project", name: "archived_at" }])).toThrow(
      /is the archive field of Project/
    );
    expect(() => apply(m, [{ op: "remove_field", entity: "Task", name: "done" }])).toThrow(
      /Project\.open_tasks counts Task rows where done = false and archived_at = null/
    );
    const assigned = model(
      raw => (raw.entities.User.fields.assigned_count = { type: "integer", count_of: "assigned" })
    );
    expect(() => apply(assigned, [{ op: "remove_field", entity: "Task", name: "assignee_id" }])).toThrow(
      /User\.assigned_count counts the rows of Task by assignee_id/
    );
  });
});

describe("archive and counts under isolation: database", () => {
  const isolated = Model.parse({
    osl: "1.0",
    name: "workspace",
    entities: {
      User: {
        fields: {
          id: { type: "uuid", primary: true },
          email: { type: "string", required: true, unique: true },
          team_count: { type: "integer", count_of: "memberships" }
        },
        rules: { read: "authenticated", update: "owner:id", delete: "none" }
      },
      Team: {
        fields: { id: { type: "uuid", primary: true }, name: { type: "string", required: true } },
        rules: { read: "member:id", create: "authenticated", update: "member:id:admin", delete: "member:id:owner" }
      },
      TeamMember: {
        fields: {
          id: { type: "uuid", primary: true },
          team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
          user_id: {
            type: "uuid",
            required: true,
            relation: { entity: "User", reverse: "memberships", on_delete: "cascade" }
          },
          role: { type: "enum", enum_values: ["owner", "admin", "member"], required: true, default: "member" }
        },
        unique: [["team_id", "user_id"]],
        rules: {
          read: "member:team_id",
          create: "member:team_id:admin",
          update: "none",
          delete: "member:team_id:owner"
        }
      },
      Project: {
        archive: { rule: "owner:created_by" },
        fields: {
          id: { type: "uuid", primary: true },
          team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
          created_by: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
          name: { type: "string", required: true },
          milestone_count: { type: "integer", count_of: "milestones" }
        },
        rules: { read: "member:team_id", create: "member:team_id", update: "member:team_id", delete: "member:team_id" }
      },
      Milestone: {
        fields: {
          id: { type: "uuid", primary: true },
          project_id: {
            type: "uuid",
            required: true,
            relation: { entity: "Project", reverse: "milestones", on_delete: "cascade" }
          },
          title: { type: "string", required: true },
          position: { type: "integer", position: { within: "project_id" } }
        },
        rules: {
          read: "member:project_id.team_id",
          create: "member:project_id.team_id",
          update: "member:project_id.team_id",
          delete: "member:project_id.team_id"
        }
      }
    },
    resources: { projects: { entity: "Project", operations: ["list", "get", "create", "update"] } },
    auth: {
      identity: "User",
      provider: "credentials",
      tenancy: {
        entity: "Team",
        membership: "TeamMember",
        role_field: "role",
        creator_role: "owner",
        isolation: "database"
      }
    }
  });

  it("warns that a count on a shared row adds up every tenant's rows (M156)", () => {
    const warnings = validateModel(isolated).filter(d => d.code === "M156");
    expect(warnings.map(d => d.path)).toEqual(["entities.User.fields.team_count"]);
    expect(warnings[0].message).toContain("adds up the rows of all of them");
  });

  it("runs the count's functions with the owner's rights and gives nobody the right to call them", () => {
    const objects = countObjects(compile(isolated));
    const functions = objects.filter(o => o.kind === "function");
    expect(functions.map(f => f.name)).toEqual([
      "osl_count_users_team_count",
      "osl_count_projects_milestone_count",
      "osl_count_hold_milestones"
    ]);
    for (const fn of functions) {
      expect(fn.body!.definer).toBe(true);
      expect(fn.create[0]).toContain("SECURITY DEFINER SET search_path = public, pg_temp");
      expect(fn.create.slice(1)).toEqual([`REVOKE ALL ON FUNCTION "${fn.name}"() FROM PUBLIC;`]);
    }
  });

  it("narrows the archive's own rule to the row's tenant, like every rule of a tenant table", () => {
    const ir = compile(isolated);
    const archive = ir.actions.find(a => a.resource === "projects" && a.name === "archive")!;
    expect(ruleText(archive.rule)).toBe("owner:created_by and member:team_id");
    expect(ruleText(ir.entities.find(e => e.name === "Project")!.archive!.rule)).toBe(
      "owner:created_by and member:team_id"
    );
  });
});
