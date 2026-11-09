import { mkdtemp, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyIntent, initProject, listIntents, loadProject, planMigration, renderPostgres } from "../src/index.js";

const FIXTURE = path.resolve(__dirname, "../../../fixtures/blog");

async function freshProject() {
  const root = await mkdtemp(path.join(tmpdir(), "osl-blog-"));
  await initProject(root, { name: "blog", backend: "drizzle-next" });
  await cp(path.join(FIXTURE, "intents"), path.join(root, ".osl/intents"), { recursive: true });
  return root;
}

describe("blog fixture", () => {
  it("applies every intent, compiles IR and plans migrations with renames", async () => {
    const root = await freshProject();
    const ids = await listIntents(root);
    expect(ids).toEqual([
      "FEAT-1",
      "FEAT-2",
      "FEAT-3",
      "FEAT-4",
      "FEAT-5",
      "FEAT-6",
      "FEAT-7",
      "FEAT-8",
      "FEAT-9",
      "FEAT-10",
      "FEAT-11",
      "FEAT-12"
    ]);

    for (const id of ids) {
      const outcome = await applyIntent(root, id);
      expect(outcome.status).toBe("applied");
    }
    const again = await applyIntent(root, "FEAT-2");
    expect(again.status).toBe("noop");

    const project = await loadProject(root);
    expect(project.lock.revisions).toHaveLength(12);
    const ir = project.ir;

    const article = ir.entities.find(e => e.name === "Article")!;
    expect(article.table).toBe("articles");
    expect(article.columns.map(c => c.name)).toEqual([
      "id",
      "title",
      "content",
      "published",
      "author_id",
      "posted_at",
      "tags",
      "cover",
      "publish_at",
      "locked"
    ]);
    expect(article.foreignKeys[0]).toMatchObject({ column: "author_id", targetTable: "users", onDelete: "cascade" });
    expect(article.relations.map(r => r.name)).toEqual(["author", "comments"]);
    const user = ir.entities.find(e => e.name === "User")!;
    expect(user.relations).toEqual([
      { name: "posts", kind: "many", direction: "reverse", target: "Article", column: "author_id", targetColumn: "id" },
      {
        name: "following",
        kind: "many",
        direction: "reverse",
        target: "Follow",
        column: "follower_id",
        targetColumn: "id"
      },
      {
        name: "followers",
        kind: "many",
        direction: "reverse",
        target: "Follow",
        column: "followee_id",
        targetColumn: "id"
      },
      {
        name: "bulletins",
        kind: "many",
        direction: "reverse",
        target: "Bulletin",
        column: "author_id",
        targetColumn: "id"
      }
    ]);
    expect(user.columns.find(c => c.name === "password_hash")).toMatchObject({ hidden: true, nullable: true });
    expect(ir.auth?.registerFields).toEqual(["name"]);

    const posts = ir.resources.find(r => r.name === "posts")!;
    const create = posts.operations.find(o => o.kind === "create")!;
    expect(create).toMatchObject({
      ownerField: "author_id",
      fields: ["title", "content", "published", "tags", "cover", "publish_at"]
    });
    const list = posts.operations.find(o => o.kind === "list")!;
    expect(list).toMatchObject({ sortable: ["title", "posted_at"], search: ["title", "content"] });
    expect(list).toMatchObject({ order: [["posted_at", "desc"]], include: ["author"] });
    expect(ir.examples.scenarios.map(s => s.name)).toEqual([
      "register and sign in",
      "alice writes a post",
      "post validation",
      "tagged articles",
      "publishing",
      "cover images",
      "search and sort",
      "magic link",
      "comments and moderation",
      "banning",
      "scheduled publishing",
      "locked articles",
      "private drafts",
      "followers read bulletins"
    ]);
    expect(ir.examples.seed.map(s => s.op)).toEqual(["posts.create", "posts.create"]);
    expect(ir.actions.map(a => `${a.resource ?? "actions"}.${a.name}:${a.scope}`)).toEqual([
      "users.ban:row",
      "posts.publish:row",
      "posts.unpublish_all:collection",
      "posts.lock:row",
      "posts.unlock:row",
      "announcements.publish:row",
      "actions.send_digest:global"
    ]);
    const publish = ir.actions.find(a => a.handler === "posts_publish");
    expect(publish).toMatchObject({
      path: "/api/posts/{id}/publish",
      rule: { kind: "owner", field: "author_id" },
      returns: { kind: "entity" },
      handler: "posts_publish"
    });
    expect(ir.events.find(e => e.name === "posts.publish")).toMatchObject({
      kind: "action",
      delivery: "queue",
      resource: "posts",
      actionName: "publish",
      entity: "Article"
    });
    expect(ir.auth!.providers.map(p => p.kind)).toEqual(["credentials", "magic_link", "oauth"]);
    expect(ir.auth!.registerable).toBe(true);
    expect(ir.entities.filter(e => e.system).map(e => e.table)).toEqual([
      "osl_files",
      "osl_auth_tokens",
      "osl_auth_states",
      "osl_auth_accounts"
    ]);

    // Migrations per revision
    const [r1, r2, r3, r4, r5] = project.lock.revisions;
    const sql1 = renderPostgres(planMigration(null, r1.ir, r1.renames));
    expect(sql1).toContain('CREATE TYPE "user_role" AS ENUM');
    expect(sql1).toContain('CREATE TABLE "users"');
    expect(sql1).toContain('"password_hash" varchar(255)');
    const sql2 = renderPostgres(planMigration(r1.ir, r2.ir, r2.renames));
    expect(sql2).toContain('CREATE TABLE "posts"');
    expect(sql2).toContain("ON DELETE CASCADE");
    expect(sql2).toContain('CONSTRAINT "posts_author_id_title_key" UNIQUE');
    expect(sql2).not.toContain('ALTER TABLE "users"');
    const plan3 = planMigration(r2.ir, r3.ir, r3.renames);
    const sql3 = renderPostgres(plan3);
    expect(sql3).toContain('ALTER TABLE "posts" RENAME TO "articles"');
    expect(sql3).toContain('RENAME COLUMN "created_at" TO "posted_at"');
    expect(sql3).toContain('ADD COLUMN "tags" varchar(255)[]');
    // The app revision touches no tables
    expect(planMigration(r3.ir, r4.ir, r4.renames).steps).toHaveLength(0);
    // The files and sign-in revision adds the cover column and OSL's own tables
    const sql5 = renderPostgres(planMigration(r4.ir, r5.ir, r5.renames));
    expect(sql5).toContain('ADD COLUMN "cover" jsonb');
    expect(sql5).toContain('CREATE TABLE "osl_files"');
    expect(sql5).toContain('CREATE TABLE "osl_auth_tokens"');
    expect(sql5).toContain('CREATE TABLE "osl_auth_accounts"');
    expect(sql5).toContain('CREATE TYPE "osl_file_status" AS ENUM');
    expect(sql3).not.toContain("DROP COLUMN");
    expect(sql3).not.toContain("DROP TABLE");
    expect(plan3.warnings).toEqual([]);

    // Determinism: compiling twice gives the same hash, and a byte-identical lock
    const lockA = await readFile(path.join(root, ".osl/model.lock.json"), "utf8");
    const reloaded = await loadProject(root);
    expect(reloaded.ir.hash).toBe(ir.hash);
    expect(await readFile(path.join(root, ".osl/model.lock.json"), "utf8")).toBe(lockA);
  });

  it("rejects a hand-edited model and a changed applied intent", async () => {
    const root = await freshProject();
    await applyIntent(root, "FEAT-1");
    const { writeFile } = await import("node:fs/promises");
    const modelPath = path.join(root, ".osl/model.yaml");
    await writeFile(modelPath, (await readFile(modelPath, "utf8")) + "\n# edited\ndescription: tampered\n");
    await expect(loadProject(root)).rejects.toThrow(/edited by hand/);
  });
});
