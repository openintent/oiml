import { describe, expect, it } from "vitest";
import { Model, applyDiff, compile, parseDiff, planMigration, renderPostgres } from "../src/index.js";

const base = Model.parse({
  osl: "1.0",
  name: "m",
  entities: {
    User: { fields: { id: { type: uuid(), primary: true }, email: { type: "string", required: true, unique: true } } },
    Post: {
      fields: {
        id: { type: "uuid", primary: true },
        title: { type: "string", required: true },
        kind: { type: "enum", enum_values: ["a", "b"], required: true, default: "a" },
        author_id: { type: "uuid", required: true, relation: { entity: "User", reverse: "posts" } }
      }
    }
  }
});

function uuid() {
  return "uuid" as const;
}

function evolve(ops: unknown[]) {
  const { model, renames } = applyDiff(base, parseDiff({ osl: "1.0", ops }));
  const prev = compile(base);
  const next = compile(model);
  const plan = planMigration(prev, next, renames);
  return { plan, sql: renderPostgres(plan) };
}

describe("migration planner", () => {
  it("creates everything from an empty database in a safe order", () => {
    const sql = renderPostgres(planMigration(null, compile(base)));
    const typeAt = sql.indexOf("CREATE TYPE");
    const tableAt = sql.indexOf('CREATE TABLE "posts"');
    const fkAt = sql.indexOf("FOREIGN KEY");
    expect(typeAt).toBeLessThan(tableAt);
    expect(tableAt).toBeLessThan(fkAt);
    expect(sql).toContain('CREATE INDEX "posts_author_id_idx"');
  });

  it("drops a column and its unique constraint, and warns on a NOT NULL add without default", () => {
    const { plan, sql } = evolve([
      { op: "remove_field", entity: "Post", name: "title" },
      { op: "add_field", entity: "Post", name: "slug", field: { type: "string", required: true } }
    ]);
    expect(sql).toContain('DROP COLUMN "title"');
    expect(sql).toContain('ADD COLUMN "slug" varchar(255) NOT NULL');
    expect(plan.warnings[0]).toMatch(/posts.slug is added NOT NULL without a default/);
  });

  it("alters type, nullability, default and uniqueness in place", () => {
    const { sql } = evolve([
      {
        op: "update_field",
        entity: "Post",
        name: "title",
        field: { type: "text", required: false, unique: true, default: "untitled" }
      }
    ]);
    expect(sql).toContain('ALTER COLUMN "title" TYPE text USING "title"::text');
    expect(sql).toContain('ALTER COLUMN "title" DROP NOT NULL');
    expect(sql).toContain(`ALTER COLUMN "title" SET DEFAULT 'untitled'`);
    expect(sql).toContain('ADD CONSTRAINT "posts_title_key" UNIQUE ("title")');
  });

  it("adds enum values and warns when one is removed", () => {
    const { plan, sql } = evolve([
      {
        op: "update_field",
        entity: "Post",
        name: "kind",
        field: { type: "enum", enum_values: ["a", "c"], required: true, default: "a" }
      }
    ]);
    expect(sql).toContain(`ALTER TYPE "post_kind" ADD VALUE IF NOT EXISTS 'c'`);
    expect(plan.warnings[0]).toMatch(/value b was removed/);
  });

  it("drops a referencing table before the referenced one and cleans up its enum", () => {
    const { sql } = evolve([{ op: "remove_entity", name: "Post" }]);
    const dropFk = sql.indexOf('DROP CONSTRAINT IF EXISTS "posts_author_id_fkey"');
    const dropTable = sql.indexOf('DROP TABLE "posts"');
    const dropEnum = sql.indexOf('DROP TYPE "post_kind"');
    expect(dropFk).toBeGreaterThan(-1);
    expect(dropFk).toBeLessThan(dropTable);
    expect(dropTable).toBeLessThan(dropEnum);
    expect(sql).not.toContain('"users"');
  });

  it("changes a foreign key's delete behavior by dropping and re-adding it", () => {
    const { sql } = evolve([
      {
        op: "update_field",
        entity: "Post",
        name: "author_id",
        field: { type: "uuid", required: true, relation: { entity: "User", reverse: "posts", on_delete: "cascade" } }
      }
    ]);
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "posts_author_id_fkey"');
    expect(sql).toContain("ON DELETE CASCADE");
  });

  it("emits nothing when the model did not change", () => {
    const ir = compile(base);
    expect(planMigration(ir, ir).steps).toEqual([]);
  });
});
