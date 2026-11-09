import { mkdtemp, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DiffError,
  applyDiff,
  applyIntent,
  compile,
  initProject,
  listIntents,
  loadProject,
  parseDiff,
  parseModel,
  validateModel,
  type Model
} from "../src/index.js";

const FIXTURES = path.resolve(__dirname, "../../../fixtures");

async function compiled(fixture: string) {
  const root = await mkdtemp(path.join(tmpdir(), `osl-${fixture}-`));
  await initProject(root, { name: fixture, backend: "drizzle-next" });
  await cp(path.join(FIXTURES, fixture, "intents"), path.join(root, ".osl/intents"), { recursive: true });
  for (const id of await listIntents(root)) await applyIntent(root, id);
  return loadProject(root);
}

function model(overrides: Partial<Model>): Model {
  return parseModel({
    osl: "1.0",
    name: "shop",
    entities: {
      Product: {
        fields: {
          id: { type: uuid(), primary: true },
          name: { type: "string", required: true },
          notes: { type: "text" },
          secret: { type: "string", hidden: true }
        }
      }
    },
    resources: {
      products: { entity: "Product", operations: ["list", "get", "create"] },
      catalog: { entity: "Product", operations: ["list"] }
    },
    ...overrides
  });
}
const uuid = () => "uuid";

describe("app section", () => {
  it("compiles the blog app with defaults filled in", async () => {
    const { ir } = await compiled("blog");
    expect(ir.app?.title).toBe("Blog");
    const posts = ir.app!.pages.find(p => p.name === "posts")!;
    expect(posts).toMatchObject({
      kind: "resource",
      resource: "posts",
      entity: "Article",
      path: "/posts",
      title: "Posts"
    });
    expect(posts.columns).toEqual(["title", "published", "posted_at"]);
    const users = ir.app!.pages.find(p => p.name === "users")!;
    expect(users.fields).toEqual(["id", "email", "name", "role", "created_at", "banned", "banned_at", "ban_reason"]);
    expect(posts.fields).toEqual(["title", "content", "published", "cover", "tags", "posted_at", "author_id"]);
    const about = ir.app!.pages.find(p => p.name === "about")!;
    expect(about).toMatchObject({ kind: "custom", path: "/about", title: "About", columns: [], fields: [] });
    expect(ir.app!.sidebar!.items.map(i => [i.label, i.path, i.icon])).toEqual([
      ["Overview", "/overview", "layout-dashboard"],
      ["Posts", "/posts", "file-text"],
      ["Archive", "/archive", "archive"],
      ["Users", "/users", "users"],
      ["About", "/about", "info"]
    ]);
    const archive = ir.app!.pages.find(p => p.name === "archive")!;
    expect(archive).toMatchObject({ kind: "resource", layout: "table", resource: "posts" });
    const overview = ir.app!.pages.find(p => p.name === "overview")!;
    expect(overview.kind).toBe("dashboard");
    expect(overview.tiles.map(t => [t.label, t.filter])).toEqual([
      ["Articles", {}],
      ["Published", { published: true }],
      ["Users", {}]
    ]);
    expect(overview.recent).toEqual([{ resource: "posts", limit: 5 }]);
    expect(ir.app!.sidebar!.footer).toEqual({ user: true, settings: true });
    expect(ir.entities.find(e => e.name === "Article")!.display).toBe("title");
    expect(ir.entities.find(e => e.name === "User")!.display).toBe("name");
  });

  it("drops the user footer without auth and picks default columns", async () => {
    const { ir } = await compiled("todo");
    expect(ir.app!.sidebar!.footer).toEqual({ user: false, settings: true });
    const projects = ir.app!.pages.find(p => p.name === "projects")!;
    expect(projects.columns[0]).toBe("name");
    expect(projects.columns.length).toBeLessThanOrEqual(4);
    expect(ir.app!.sidebar!.items.map(i => i.label)).toEqual(["Home", "Board", "Projects"]);
    expect(ir.app!.pages.find(p => p.name === "tasks")).toMatchObject({ layout: "board", groupBy: "status" });
  });

  it("validates pages and sidebar items", () => {
    const bad = model({
      app: {
        pages: {
          products: { resource: "products", columns: ["secret"] },
          catalog: { resource: "catalog" },
          login: { kind: "custom" },
          dupe: { resource: "products", path: "/products" }
        },
        sidebar: { items: [{ page: "missing" }] }
      }
    } as Partial<Model>);
    const codes = validateModel(bad)
      .map(d => d.code)
      .sort();
    expect(codes).toEqual(["M080", "M082", "M083", "M084", "M085"]);
  });

  it("keeps pages consistent through field renames and refuses to orphan them", () => {
    const base = model({
      app: { pages: { products: { resource: "products", columns: ["name"], fields: ["name", "notes"] } } }
    } as Partial<Model>);
    const renamed = applyDiff(
      base,
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Product", from: "name", to: "label" }] })
    ).model;
    expect(renamed.app!.pages.products.columns).toEqual(["label"]);
    expect(renamed.app!.pages.products.fields).toEqual(["label", "notes"]);
    expect(() =>
      applyDiff(base, parseDiff({ osl: "1.0", ops: [{ op: "remove_resource", name: "products" }] }))
    ).toThrow(DiffError);
    const removed = applyDiff(
      base,
      parseDiff({
        osl: "1.0",
        ops: [
          { op: "set_sidebar", sidebar: { items: [{ page: "products" }] } },
          { op: "remove_page", name: "products" }
        ]
      })
    ).model;
    expect(removed.app!.sidebar!.items).toEqual([]);
    expect(compile(removed).app!.pages).toEqual([]);
  });
});
