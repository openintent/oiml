import { mkdtemp, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyIntent,
  diffOpenApi,
  explainedBy,
  initProject,
  isRewrite,
  listIntents,
  loadProject,
  openapiDocument,
  planMigration,
  readIntent,
  type DiffOp,
  type MigrationStep
} from "../src/index.js";

const FIXTURES = path.resolve(__dirname, "../../../fixtures");

async function projectFor(fixture: string) {
  const root = await mkdtemp(path.join(tmpdir(), `osl-contract-`));
  await initProject(root, { name: fixture, backend: "drizzle-next" });
  await cp(path.join(FIXTURES, fixture, "intents"), path.join(root, ".osl/intents"), { recursive: true });
  for (const id of await listIntents(root)) await applyIntent(root, id);
  return { root, project: await loadProject(root) };
}

type Doc = Record<string, unknown>;

describe("the contract diff", () => {
  it("reports nothing when nothing changed, and only removals and narrowings otherwise", async () => {
    const { project } = await projectFor("blog");
    const doc = openapiDocument(project.ir);
    expect(diffOpenApi(doc, doc)).toEqual([]);
  });

  it("names a dropped route, a lost property, a narrowed type and a new required field", async () => {
    const { project } = await projectFor("blog");
    const before = openapiDocument(project.ir) as Doc & {
      paths: Record<string, Record<string, Doc>>;
      components: { schemas: Record<string, Doc> };
    };
    const after = structuredClone(before);
    delete after.paths["/api/posts/{id}/publish"];
    delete after.paths["/api/comments"].post;
    const article = after.components.schemas.Article as { properties: Record<string, Doc>; required?: string[] };
    delete article.properties.content;
    article.properties.title = { type: "string", maxLength: 10 };
    const createPosts = after.paths["/api/posts"].post as {
      requestBody: { content: Record<string, { schema: { required?: string[] } }> };
    };
    const body = createPosts.requestBody.content["application/json"].schema;
    body.required = [...(body.required ?? []), "osl_new_field"];
    const changes = diffOpenApi(before, after);
    expect(changes.map(c => c.kind).sort()).toEqual(
      ["added_required", "narrowed_type", "removed_operation", "removed_path", "removed_property"].sort()
    );
    expect(changes.find(c => c.kind === "removed_path")?.detail).toBe("/api/posts/{id}/publish was removed");
    expect(changes.find(c => c.kind === "narrowed_type")?.detail).toContain("shortened to 10 characters");
  });

  it("explains a change by an op on the same entity, resource or action, and nothing else", async () => {
    const { project } = await projectFor("blog");
    const doc = openapiDocument(project.ir) as Doc & { paths: Record<string, Record<string, Doc>> };
    const after = structuredClone(doc);
    delete after.paths["/api/posts/{id}/publish"];
    const [dropped] = diffOpenApi(doc, after);
    expect(dropped.kind).toBe("removed_path");
    const unrelated: DiffOp[] = [{ op: "set_description", description: "nothing to do with posts" }];
    expect(explainedBy(dropped, unrelated, project.ir)).toBe(false);
    const onTheAction: DiffOp[] = [{ op: "remove_action", resource: "posts", name: "publish" }];
    expect(explainedBy(dropped, onTheAction, project.ir)).toBe(true);
    const onTheEntity: DiffOp[] = [{ op: "remove_entity", name: "Article" }];
    expect(explainedBy(dropped, onTheEntity, project.ir)).toBe(true);
    const onAnotherEntity: DiffOp[] = [{ op: "remove_entity", name: "Comment" }];
    expect(explainedBy(dropped, onAnotherEntity, project.ir)).toBe(false);
  });

  it("finds every breaking change between the blog's revisions explained by the revision's own diff", async () => {
    const { root, project } = await projectFor("blog");
    const revisions = project.lock.revisions;
    let breaking = 0;
    for (let i = 1; i < revisions.length; i++) {
      const changes = diffOpenApi(openapiDocument(revisions[i - 1].ir), openapiDocument(revisions[i].ir));
      breaking += changes.length;
      const ops = (await readIntent(root, revisions[i].intent)).diff!.ops;
      for (const change of changes) expect(explainedBy(change, ops, revisions[i - 1].ir), change.detail).toBe(true);
    }
    // FEAT-3 renames Post to Article, which the schema diff sees as a removed schema
    expect(breaking).toBeGreaterThan(0);
  });

  it("marks the steps that rewrite a table", async () => {
    const { project } = await projectFor("blog");
    const next = project.ir;
    const article = next.entities.find(e => e.name === "Article")!;
    const table = article.table;
    const typeChange: MigrationStep = {
      kind: "alter_column_type",
      table,
      column: article.columns.find(c => c.name === "title")!
    };
    expect(isRewrite(typeChange, next)).toBe(true);
    // published has a default, so NOT NULL on it rewrites nothing; title has none
    expect(isRewrite({ kind: "set_not_null", table, column: "published", notNull: true }, next)).toBe(false);
    expect(isRewrite({ kind: "set_not_null", table, column: "title", notNull: true }, next)).toBe(true);
    expect(isRewrite({ kind: "set_not_null", table, column: "title", notNull: false }, next)).toBe(false);
    const plan = planMigration(null, next);
    expect(plan.rewrites).toEqual([]);
  });
});
