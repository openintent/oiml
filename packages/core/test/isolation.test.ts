import { describe, expect, it } from "vitest";
import {
  Model,
  applyDiff,
  canonicalExpression,
  compile,
  isolationDrift,
  isolationObjects,
  parseDiff,
  planMigration,
  publicReadExpression,
  renderPostgres,
  ruleText,
  tenantLinks,
  validateModel,
  type LiveIsolation
} from "../src/index.js";

/** Teams with members, projects in a team, tasks in a project (public when the project is), and a shared lookup */
function model(isolation: "none" | "database" | undefined, change: (m: Record<string, any>) => void = () => {}): Model {
  const raw: Record<string, any> = {
    osl: "1.0",
    name: "work-space",
    entities: {
      User: {
        fields: {
          id: { type: "uuid", primary: true },
          email: { type: "string", required: true, unique: true },
          name: { type: "string", required: true }
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
          user_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
          role: { type: "enum", enum_values: ["owner", "admin", "member"], required: true, default: "member" }
        },
        unique: [["team_id", "user_id"]],
        rules: {
          read: "member:team_id",
          create: "member:team_id:admin",
          update: "member:team_id:admin",
          delete: "member:team_id:owner"
        }
      },
      Project: {
        fields: {
          id: { type: "uuid", primary: true },
          team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
          name: { type: "string", required: true },
          public: { type: "boolean", required: true, default: false }
        },
        rules: {
          read: "member:team_id",
          create: "member:team_id",
          update: "member:team_id",
          delete: "member:team_id:admin"
        }
      },
      Task: {
        fields: {
          id: { type: "uuid", primary: true },
          project_id: { type: "uuid", required: true, relation: { entity: "Project", on_delete: "cascade" } },
          title: { type: "string", required: true },
          assignee_id: { type: "uuid", relation: { entity: "User", on_delete: "set_null" } }
        },
        rules: {
          read: "public when project_id.public = true or owner:assignee_id or member:project_id.team_id:admin",
          create: "member:project_id.team_id",
          update: "owner:assignee_id or member:project_id.team_id:admin",
          delete: "member:project_id.team_id:admin"
        }
      },
      Label: {
        fields: { id: { type: "uuid", primary: true }, name: { type: "string", required: true } },
        rules: { read: "authenticated", create: "authenticated", update: "none", delete: "none" }
      }
    },
    auth: {
      identity: "User",
      providers: ["credentials"],
      tenancy: { entity: "Team", membership: "TeamMember", role_field: "role", creator_role: "owner" }
    },
    resources: {
      tasks: { entity: "Task", operations: ["list", "get", "create", "update", "delete"] }
    }
  };
  if (isolation) raw.auth.tenancy.isolation = isolation;
  change(raw);
  return Model.parse(raw);
}

const codes = (m: Model, level: "error" | "warning") =>
  validateModel(m)
    .filter(d => d.level === level)
    .map(d => d.code);

describe("isolation: database, the tenant tables", () => {
  it("is absent without the key, and with none: the IR is the one a model without it compiles to", () => {
    const plain = compile(model(undefined));
    expect(tenantLinks(model(undefined)).links).toEqual({});
    expect(plain.auth!.tenancy!.isolation).toBeUndefined();
    expect(plain.entities.every(e => e.tenant === undefined)).toBe(true);
    expect(isolationObjects(plain)).toEqual([]);
    const none = compile(model("none"));
    expect(none.entities).toEqual(plain.entities);
    expect(isolationObjects(none)).toEqual([]);
  });

  it("finds the tenant column of every table that reaches the tenant through required relations", () => {
    const { links, problems } = tenantLinks(model("database"));
    expect(problems).toEqual([]);
    expect(links).toEqual({
      Team: { field: "id", path: ["id"] },
      TeamMember: { field: "team_id", path: ["team_id"] },
      Project: { field: "team_id", path: ["team_id"] },
      Task: { field: "team_id", through: "project_id", path: ["project_id", "team_id"] }
    });
    const ir = compile(model("database"));
    expect(ir.auth!.tenancy!.isolation).toEqual({
      appRole: "work_space_app",
      setting: "app.team_ids",
      tenantType: "uuid",
      memberships: "osl_memberships"
    });
    const task = ir.entities.find(e => e.name === "Task")!;
    // The derived column is the table's, never the entity's: no backend reads or writes it
    expect(task.columns.map(c => c.name)).not.toContain("team_id");
    expect(task.tenant).toMatchObject({
      column: "team_id",
      type: "uuid",
      derived: { through: "project_id", parentTable: "projects", parentKey: "id", parentColumn: "team_id" },
      keys: [
        {
          name: "tasks_team_id_project_id_fkey",
          columns: ["team_id", "project_id"],
          targetTable: "projects",
          targetColumns: ["team_id", "id"],
          onDelete: "cascade",
          cascade: true
        }
      ],
      exists: "osl_exists_tasks"
    });
    expect(ir.entities.find(e => e.name === "Project")!.tenant!.unique).toEqual({
      name: "projects_team_id_id_key",
      columns: ["team_id", "id"]
    });
    // Shared tables have no tenant: the identity, a lookup with no way to the tenant
    expect(ir.entities.find(e => e.name === "User")!.tenant).toBeUndefined();
    expect(ir.entities.find(e => e.name === "Label")!.tenant).toBeUndefined();
  });

  it("refuses two ways to the tenant, a tenant key the app cannot generate, and an identity under a tenant", () => {
    const two = model("database", m => {
      m.entities.Task.fields.second_id = { type: "uuid", required: true, relation: { entity: "Project" } };
    });
    expect(codes(two, "error")).toContain("M124");
    const declared = model("database", m => {
      m.entities.Task.fields.second_id = { type: "uuid", required: true, relation: { entity: "Project" } };
      m.entities.Task.fields.team_id = { type: "uuid", required: true, relation: { entity: "Team" } };
    });
    expect(codes(declared, "error")).not.toContain("M124");
    expect(compile(declared).entities.find(e => e.name === "Task")!.tenant).toMatchObject({
      column: "team_id",
      keys: [{ columns: ["team_id", "project_id"] }, { columns: ["team_id", "second_id"] }]
    });
    const integerKey = model("database", m => {
      m.entities.Team.fields.id = { type: "integer", primary: true };
      for (const e of ["TeamMember", "Project"]) m.entities[e].fields.team_id.type = "integer";
    });
    expect(codes(integerKey, "error")).toContain("M127");
    const identity = model("database", m => {
      m.entities.User.fields.team_id = { type: "uuid", required: true, relation: { entity: "Team" } };
    });
    expect(codes(identity, "error")).toContain("M127");
  });

  it("warns that an entity reaching the tenant only through an optional relation stays shared", () => {
    const optional = model("database", m => {
      m.entities.Label.fields.project_id = { type: "uuid", relation: { entity: "Project", on_delete: "set_null" } };
    });
    expect(codes(optional, "warning")).toContain("M125");
    expect(compile(optional).entities.find(e => e.name === "Label")!.tenant).toBeUndefined();
  });
});

describe("isolation: database, the rules", () => {
  it("adds the membership of the row's tenant to every alternative that needs a session, and says so", () => {
    const ir = compile(model("database"));
    const task = ir.entities.find(e => e.name === "Task")!;
    expect(ruleText(task.rules.read)).toBe(
      "public when project_id.public = true or owner:assignee_id and member:project_id.team_id or member:project_id.team_id:admin"
    );
    expect(ruleText(task.rules.update)).toBe(
      "owner:assignee_id and member:project_id.team_id or member:project_id.team_id:admin"
    );
    // Already a membership of the tenant: left as written
    expect(ruleText(task.rules.create)).toBe("member:project_id.team_id");
    // Whoever creates a tenant becomes its first member, so its create rule asks for none
    expect(ruleText(ir.entities.find(e => e.name === "Team")!.rules.create)).toBe("authenticated");
    // The operations carry the compiled rule
    const get = ir.resources[0].operations.find(o => o.kind === "get")!;
    expect(get.rule).toEqual(task.rules.read);
    const warnings = validateModel(model("database")).filter(d => d.code === "M128");
    expect(warnings.map(w => w.path)).toEqual(["entities.Task.rules.read", "entities.Task.rules.update"]);
    expect(warnings[0].message).toContain(
      '"owner:assignee_id" is compiled as "owner:assignee_id and member:project_id.team_id"'
    );
  });

  it("leaves the rules of a model without isolation as they are written", () => {
    const task = compile(model(undefined)).entities.find(e => e.name === "Task")!;
    expect(ruleText(task.rules.read)).toBe(
      "public when project_id.public = true or owner:assignee_id or member:project_id.team_id:admin"
    );
    expect(codes(model(undefined), "warning")).not.toContain("M128");
  });

  it("lets a caller without a session reach a tenant table through its read rule only", () => {
    const write = model("database", m => {
      m.entities.Task.rules.update = "public when project_id.public = true or member:project_id.team_id";
    });
    expect(codes(write, "error")).toContain("M126");
    const action = model("database", m => {
      m.resources.tasks.actions = { nudge: { rule: "public" } };
    });
    expect(codes(action, "error")).toContain("M126");
    const joined = model("database", m => {
      m.entities.Task.rules.read = "public when project_id.public = true and owner:assignee_id";
    });
    expect(codes(joined, "error")).toContain("M126");
    expect(codes(model("database"), "error")).toEqual([]);
  });

  it("names a reader for a public alternative's path, and compiles the alternative into the read policy", () => {
    const ir = compile(model("database"));
    const task = ir.entities.find(e => e.name === "Task")!;
    expect(publicReadExpression(task)).toBe('"osl_read_tasks_project_id_public"("project_id") = true');
    expect(publicReadExpression(ir.entities.find(e => e.name === "Project")!)).toBeNull();
    const own = compile(
      model("database", m => {
        m.entities.Project.rules.read = "public when public = true or member:team_id";
      })
    );
    expect(publicReadExpression(own.entities.find(e => e.name === "Project")!)).toBe('"public" = true');
    const negated = compile(
      model("database", m => {
        m.entities.Project.rules.read = "public when name != secret or member:team_id";
      })
    );
    expect(publicReadExpression(negated.entities.find(e => e.name === "Project")!)).toBe(
      "\"name\" IS DISTINCT FROM 'secret'"
    );
  });
});

describe("isolation: database, the migration", () => {
  const turnOn = () => {
    const before = compile(model(undefined));
    const after = compile(model("database"));
    return renderPostgres(planMigration(before, after));
  };

  it("creates the whole layer with new tables: column, composite key, role, functions, trigger, policies", () => {
    const sql = renderPostgres(planMigration(null, compile(model("database"))));
    expect(sql).toMatch(/CREATE TABLE "tasks" \([^;]*"team_id" uuid NOT NULL/);
    expect(sql).toContain('CONSTRAINT "projects_team_id_id_key" UNIQUE ("team_id", "id")');
    expect(sql).toContain(
      'ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_project_id_fkey" FOREIGN KEY ("team_id", "project_id") REFERENCES "projects" ("team_id", "id") ON UPDATE CASCADE ON DELETE CASCADE;'
    );
    expect(sql).toContain(`IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'work_space_app') THEN`);
    expect(sql).toContain('CREATE ROLE "work_space_app" NOLOGIN;');
    expect(sql).toContain("EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;");
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON "tasks" TO "work_space_app";');
    expect(sql).toContain('CREATE FUNCTION "osl_memberships"(uuid) RETURNS TABLE (tenant uuid, role text)');
    expect(sql).toContain('CREATE FUNCTION "osl_exists_tasks"(uuid) RETURNS boolean');
    expect(sql).toContain('CREATE FUNCTION "osl_read_tasks_project_id_public"(uuid) RETURNS boolean');
    expect(sql).toContain(
      'CREATE TRIGGER "osl_tenant" BEFORE INSERT OR UPDATE OF "project_id" ON "tasks" FOR EACH ROW EXECUTE FUNCTION "osl_tenant_tasks"();'
    );
    expect(sql).toContain('ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;');
    expect(sql).not.toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain(
      `CREATE POLICY "tasks_tenant" ON "tasks" USING ("team_id" = ANY (NULLIF(current_setting('app.team_ids', true), '')::uuid[]));`
    );
    expect(sql).toContain(
      'CREATE POLICY "tasks_public_read" ON "tasks" FOR SELECT USING ("osl_read_tasks_project_id_public"("project_id") = true);'
    );
    // No secret: the role cannot sign in until the environment gives it a password
    expect(sql).not.toMatch(/PASSWORD\s+'/i);
    // The shared tables are granted and carry no policy
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON "labels" TO "work_space_app";');
    expect(sql).not.toContain('ON "labels" USING');
    expect(sql).not.toContain('ON "users" USING');
  });

  it("turns isolation on over tables that have rows: nullable column, backfill from the parent, then NOT NULL and the keys", () => {
    const sql = turnOn();
    const add = sql.indexOf('ALTER TABLE "tasks" ADD COLUMN "team_id" uuid;');
    const fill = sql.indexOf(
      'UPDATE "tasks" AS child SET "team_id" = parent."team_id" FROM "projects" AS parent WHERE parent."id" = child."project_id";'
    );
    const notNull = sql.indexOf('ALTER TABLE "tasks" ALTER COLUMN "team_id" SET NOT NULL;');
    const unique = sql.indexOf('ADD CONSTRAINT "projects_team_id_id_key" UNIQUE');
    const key = sql.indexOf('ADD CONSTRAINT "tasks_team_id_project_id_fkey"');
    const policy = sql.indexOf('CREATE POLICY "tasks_tenant"');
    for (const at of [add, fill, notNull, unique, key, policy]) expect(at).toBeGreaterThanOrEqual(0);
    expect([add, fill, notNull, unique, key, policy]).toEqual(
      [add, fill, notNull, unique, key, policy].sort((a, b) => a - b)
    );
    const plan = planMigration(compile(model(undefined)), compile(model("database")));
    expect(plan.rewrites.map(s => s.kind)).toEqual(["backfill_tenant"]);
  });

  it("fills a parent's derived column before its children's", () => {
    const deep = (isolation: "database" | undefined) =>
      model(isolation, m => {
        // Declared before its parent, so the order of the model does not decide the order of the backfill
        m.entities = {
          Comment: {
            fields: {
              id: { type: "uuid", primary: true },
              task_id: { type: "uuid", required: true, relation: { entity: "Task", on_delete: "cascade" } }
            },
            rules: { read: "member:task_id.project_id.team_id", create: "member:task_id.project_id.team_id" }
          },
          ...m.entities
        };
      });
    const sql = renderPostgres(planMigration(compile(deep(undefined)), compile(deep("database"))));
    expect(sql.indexOf('UPDATE "tasks" AS child')).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf('UPDATE "tasks" AS child')).toBeLessThan(sql.indexOf('UPDATE "comments" AS child'));
    expect(sql).toContain('REFERENCES "tasks" ("team_id", "id") ON UPDATE CASCADE ON DELETE CASCADE');
  });

  it("changes nothing when nothing of the layer changed, and remakes a policy with the function it calls", () => {
    const on = compile(model("database"));
    expect(planMigration(on, on).steps).toEqual([]);
    const { model: renamed, renames } = applyDiff(
      model("database"),
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Project", from: "public", to: "open" }] })
    );
    const sql = renderPostgres(planMigration(on, compile(renamed), renames));
    // Dropped by their old definition before the rename, made again after it
    const dropPolicy = sql.indexOf('DROP POLICY IF EXISTS "tasks_public_read" ON "tasks";');
    const dropReader = sql.indexOf('DROP FUNCTION IF EXISTS "osl_read_tasks_project_id_public"(uuid);');
    const rename = sql.indexOf('ALTER TABLE "projects" RENAME COLUMN "public" TO "open";');
    const makeReader = sql.indexOf('CREATE FUNCTION "osl_read_tasks_project_id_open"(uuid)');
    const makePolicy = sql.indexOf('CREATE POLICY "tasks_public_read" ON "tasks" FOR SELECT');
    expect([dropPolicy, dropReader, rename, makeReader, makePolicy].every(at => at >= 0)).toBe(true);
    expect([dropPolicy, dropReader, rename, makeReader, makePolicy]).toEqual(
      [dropPolicy, dropReader, rename, makeReader, makePolicy].sort((a, b) => a - b)
    );
    // The tenant policy of the table did not change, so it stays
    expect(sql).not.toContain('DROP POLICY IF EXISTS "tasks_tenant"');
  });

  it("turns isolation off: the layer goes before the keys and the derived column, and the role stays", () => {
    const sql = renderPostgres(planMigration(compile(model("database")), compile(model(undefined))));
    const dropPolicy = sql.indexOf('DROP POLICY IF EXISTS "tasks_tenant" ON "tasks";');
    const disable = sql.indexOf('ALTER TABLE "tasks" DISABLE ROW LEVEL SECURITY;');
    const dropKey = sql.indexOf('ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_team_id_project_id_fkey";');
    const dropUnique = sql.indexOf('ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_team_id_id_key";');
    const dropColumn = sql.indexOf('ALTER TABLE "tasks" DROP COLUMN "team_id";');
    expect([dropPolicy, disable, dropKey, dropUnique, dropColumn].every(at => at >= 0)).toBe(true);
    expect([dropPolicy, disable, dropKey, dropUnique, dropColumn]).toEqual(
      [dropPolicy, disable, dropKey, dropUnique, dropColumn].sort((a, b) => a - b)
    );
    expect(sql).toContain('REVOKE ALL ON "tasks" FROM "work_space_app";');
    expect(sql).not.toContain("DROP ROLE");
  });

  it("keeps an optional relation between tenant tables in one tenant, clearing only the relation on delete", () => {
    const linked = model("database", m => {
      m.entities.Task.fields.blocked_by = { type: "uuid", relation: { entity: "Task", on_delete: "set_null" } };
    });
    const sql = renderPostgres(planMigration(null, compile(linked)));
    expect(sql).toContain(
      'ADD CONSTRAINT "tasks_team_id_blocked_by_fkey" FOREIGN KEY ("team_id", "blocked_by") REFERENCES "tasks" ("team_id", "id") ON DELETE SET NULL ("blocked_by");'
    );
    expect(sql).toContain('CONSTRAINT "tasks_team_id_id_key" UNIQUE ("team_id", "id")');
  });
});

describe("isolation: database, the drift check", () => {
  const ir = compile(model("database"));
  const live = (): LiveIsolation => {
    const objects = isolationObjects(ir);
    return {
      secured: objects.filter(o => o.kind === "rls").map(o => o.table!),
      // As PostgreSQL prints a stored expression: its own parentheses and casts
      policies: objects
        .filter(o => o.kind === "policy")
        .map(o => ({
          table: o.table!,
          name: o.name,
          command: o.policy!.command,
          using:
            o.name === "tasks_tenant"
              ? "(team_id = ANY ((NULLIF(current_setting('app.team_ids'::text, true), ''::text))::uuid[]))"
              : o.name === "tasks_public_read"
                ? "(osl_read_tasks_project_id_public(project_id) = true)"
                : `(${o.policy!.using})`,
          check: null
        })),
      functions: objects
        .filter(o => o.kind === "function")
        .map(o => ({ name: o.name, definer: true, source: `\n${o.body!.source}\n` })),
      triggers: objects.filter(o => o.kind === "trigger").map(o => ({ table: o.table!, name: o.name }))
    };
  };

  it("finds none when the database holds what the model says, however PostgreSQL spells the expressions", () => {
    expect(isolationDrift(ir, live())).toEqual([]);
    expect(canonicalExpression("((status)::text = 'active'::text)")).toBe(canonicalExpression(`"status" = 'active'`));
    expect(canonicalExpression("(kind IS DISTINCT FROM 'a'::post_kind)")).toBe(
      canonicalExpression(`"kind" IS DISTINCT FROM 'a'`)
    );
    expect(canonicalExpression("((a = 1) OR (b = true))")).toBe(canonicalExpression(`"a" = 1 OR "b" = true`));
  });

  it("names a policy that was opened, dropped or added, a table without row security, and a forced one", () => {
    const opened = live();
    opened.policies.find(p => p.name === "tasks_tenant")!.using = "true";
    expect(isolationDrift(ir, opened).map(d => `${d.kind} ${d.name}`)).toEqual(["policy tasks_tenant"]);
    const dropped = live();
    dropped.policies = dropped.policies.filter(p => p.name !== "projects_tenant");
    dropped.policies.push({ table: "projects", name: "mine", command: "ALL", using: "true", check: null });
    expect(isolationDrift(ir, dropped).map(d => `${d.kind} ${d.name}`)).toEqual([
      "missing_policy projects_tenant",
      "extra_policy mine"
    ]);
    const off = live();
    off.secured = off.secured.filter(t => t !== "team_members");
    off.forced = ["tasks"];
    expect(isolationDrift(ir, off).map(d => `${d.kind} ${d.table} ${d.actual}`)).toEqual([
      "row_security team_members disabled",
      "row_security tasks forced"
    ]);
  });

  it("names a function whose body changed or that no longer runs with its owner's rights, and a missing trigger", () => {
    const changed = live();
    changed.functions.find(f => f.name === "osl_exists_tasks")!.source = "SELECT true";
    changed.functions.find(f => f.name === "osl_memberships")!.definer = false;
    changed.functions = changed.functions.filter(f => f.name !== "osl_tenant_tasks");
    changed.triggers = [];
    expect(isolationDrift(ir, changed).map(d => `${d.kind} ${d.name}`)).toEqual([
      "function osl_memberships",
      "function osl_exists_tasks",
      "missing_function osl_tenant_tasks",
      "missing_trigger osl_tenant"
    ]);
  });

  it("reports row security someone switched on by hand when the model has no isolation", () => {
    const plain = compile(model(undefined));
    const found = isolationDrift(plain, {
      secured: ["tasks"],
      policies: [{ table: "tasks", name: "p", command: "ALL", using: "true", check: null }],
      functions: [],
      triggers: []
    });
    expect(found.map(d => d.kind)).toEqual(["row_security", "extra_policy"]);
  });
});
