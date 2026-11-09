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
    expect(posts.columns).toEqual(["title", "published", "locked", "posted_at"]);
    const users = ir.app!.pages.find(p => p.name === "users")!;
    expect(users.fields).toEqual(["id", "email", "name", "role", "created_at", "banned", "banned_at", "ban_reason"]);
    expect(posts.fields).toEqual([
      "title",
      "content",
      "published",
      "locked",
      "cover",
      "tags",
      "posted_at",
      "author_id"
    ]);
    const about = ir.app!.pages.find(p => p.name === "about")!;
    expect(about).toMatchObject({ kind: "custom", path: "/about", title: "About", columns: [], fields: [] });
    expect(ir.app!.sidebar!.items.map(i => [i.label, i.path, i.icon])).toEqual([
      ["Home", "/", "house"],
      ["My articles", "/my-posts", "pen-line"],
      ["Posts", "/posts", "file-text"],
      ["Announcements", "/announcements", "megaphone"],
      ["Archive", "/archive", "archive"],
      ["Moderation", "/moderation", "shield"],
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
      ["By author", {}],
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

  it("compiles page access, fixed filters, refresh and grouped tiles", async () => {
    const { ir } = await compiled("blog");
    const overview = ir.app!.pages.find(p => p.name === "overview")!;
    expect(overview).toMatchObject({ kind: "dashboard", path: "/", refresh: 30, access: { kind: "public" } });
    expect(overview.tiles.map(t => t.label)).toEqual(["Articles", "Published", "By author", "Users"]);
    expect(overview.tiles[2].groupBy).toEqual({
      field: "author_id",
      kind: "relation",
      resource: "users",
      entity: "User",
      key: "id",
      display: "name"
    });
    const mine = ir.app!.pages.find(p => p.name === "my_posts")!;
    expect(mine).toMatchObject({ kind: "resource", resource: "posts", access: { kind: "authenticated" } });
    expect(mine.filter).toEqual({ author_id: { actor: "id" } });
    const moderation = ir.app!.pages.find(p => p.name === "moderation")!;
    expect(moderation.access).toEqual({ kind: "role", value: "admin" });
    expect(ir.app!.sidebar!.items.find(i => i.page === "moderation")!.access).toEqual({ kind: "role", value: "admin" });
    expect(ir.app!.sidebar!.items[0]).toMatchObject({ page: "overview", path: "/" });

    const { ir: todo } = await compiled("todo");
    const home = todo.app!.pages.find(p => p.name === "home")!;
    expect(home.path).toBe("/");
    expect(home.tiles.map(t => t.groupBy?.kind ?? "none")).toEqual(["none", "enum", "relation", "none"]);
    expect(home.tiles[1].groupBy).toMatchObject({ kind: "enum", values: ["todo", "doing", "done"] });
    expect(home.access).toEqual({ kind: "public" });
  });

  it("refuses public pages over private data, user filters on public pages and bad tile groups", () => {
    const bad = parseModel({
      osl: "1.0",
      name: "shop",
      entities: {
        User: {
          fields: {
            id: { type: "uuid", primary: true },
            email: { type: "string", required: true, unique: true },
            name: { type: "string", required: true }
          },
          rules: { read: "authenticated" }
        },
        Product: {
          fields: {
            id: { type: "uuid", primary: true },
            name: { type: "string", required: true },
            published: { type: "boolean", required: true, default: false },
            owner_id: { type: "uuid", required: true, relation: { entity: "User" } }
          },
          rules: { create: "owner:owner_id" }
        }
      },
      auth: { identity: "User", provider: "credentials" },
      resources: {
        products: {
          entity: "Product",
          operations: ["list", "get", "create"],
          list: { filters: ["published", "owner_id"] }
        },
        users: { entity: "User", operations: ["list", "get"] }
      },
      app: {
        pages: {
          people: { resource: "users", access: "public" },
          mine: { resource: "products", access: "public", filter: { owner_id: "{actor.id}" } },
          odd: { resource: "products", filter: { name: "x" } },
          staff: { resource: "products", access: "role:admin" },
          home: {
            kind: "dashboard",
            path: "/",
            tiles: [
              { resource: "products", label: "By name", group_by: "name" },
              { resource: "products", label: "By owner", group_by: "owner_id" }
            ]
          }
        }
      }
    } as never);
    const codes = validateModel(bad).map(d => `${d.code}:${d.path}`);
    expect(codes).toContain("M092:app.pages.people.resource");
    expect(codes).toContain("M092:app.pages.mine.filter");
    expect(codes).toContain("M089:app.pages.odd.filter");
    expect(codes).toContain("M091:app.pages.staff.access");
    expect(codes).toContain("M089:app.pages.home.tiles[0]");
    expect(codes.filter(c => c.startsWith("M089:app.pages.home.tiles[1]"))).toEqual([]);
    expect(() => model({ app: { pages: { landing: { resource: "products", path: "/" } } } } as Partial<Model>)).toThrow(
      /resource page cannot take/
    );
  });
});
