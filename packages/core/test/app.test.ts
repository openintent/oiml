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
    expect(users.fields).toEqual([
      "id",
      "email",
      "name",
      "role",
      "created_at",
      "banned",
      "banned_at",
      "ban_reason",
      "post_count",
      "approved_count",
      "phone",
      "preferences",
      "recovery_code"
    ]);
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
      ["Editorial desk", "/desk", "kanban"],
      ["Announcements", "/announcements", "megaphone"],
      ["Archive", "/archive", "archive"],
      ["Moderation", "/moderation", "shield"],
      ["Users", "/users", "users"],
      ["Integrations", "/integrations", "plug"],
      ["About", "/about", "info"]
    ]);
    const archive = ir.app!.pages.find(p => p.name === "archive")!;
    expect(archive).toMatchObject({ kind: "resource", layout: "table", resource: "posts" });
    const overview = ir.app!.pages.find(p => p.name === "overview")!;
    expect(overview.kind).toBe("dashboard");
    expect(overview.tiles.map(t => [t.label, t.filter])).toEqual([
      ["Articles", {}],
      ["Published", { published: true }],
      ["Archived", { archived: true }],
      ["By author", {}],
      ["Users", {}]
    ]);
    expect(overview.recent).toEqual([{ resource: "posts", limit: 5, filter: {} }]);
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
    expect(overview.tiles.map(t => t.label)).toEqual(["Articles", "Published", "Archived", "By author", "Users"]);
    expect(overview.tiles[3].groupBy).toEqual({
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

/** A small tenant model: teams with members, channels in a team, messages in a channel */
function desk(app: unknown, patch: (m: Record<string, any>) => void = () => {}): Model {
  const id = { type: "uuid", primary: true };
  const to = (entity: string, name: string, reverse: string) => ({
    type: "uuid",
    required: true,
    relation: { entity, name, reverse, on_delete: "cascade" }
  });
  const raw: Record<string, any> = {
    osl: "1.0",
    name: "desk",
    entities: {
      User: {
        fields: {
          id,
          email: { type: "string", required: true, unique: true },
          name: { type: "string", required: true }
        },
        rules: { read: "public" }
      },
      Team: {
        fields: { id, name: { type: "string", required: true } },
        rules: { read: "member:id", create: "authenticated" }
      },
      TeamMember: {
        fields: {
          id,
          team_id: to("Team", "team", "members"),
          user_id: to("User", "user", "memberships"),
          role: { type: "enum", enum_values: ["owner", "member"], required: true, default: "member" }
        },
        unique: [["team_id", "user_id"]],
        rules: { read: "member:team_id" }
      },
      Channel: {
        fields: {
          id,
          team_id: to("Team", "team", "channels"),
          name: { type: "string", required: true },
          secret: { type: "string", hidden: true }
        },
        rules: { read: "member:team_id", create: "member:team_id" }
      },
      Message: {
        fields: {
          id,
          channel_id: to("Channel", "channel", "messages"),
          author_id: to("User", "author", "messages"),
          body: { type: "text", required: true },
          pinned: { type: "boolean", required: true, default: false },
          created_at: { type: "datetime", required: true, default: "now" }
        },
        rules: { read: "member:channel_id.team_id", create: "member:channel_id.team_id and owner:author_id" }
      }
    },
    auth: {
      identity: "User",
      providers: ["credentials"],
      tenancy: { entity: "Team", membership: "TeamMember", role_field: "role", creator_role: "owner" }
    },
    resources: {
      users: { entity: "User", operations: ["list", "get"] },
      teams: { entity: "Team", operations: ["list", "get", "create"] },
      members: { entity: "TeamMember", operations: ["list", "get"], list: { filters: ["team_id", "user_id"] } },
      channels: {
        entity: "Channel",
        operations: ["list", "get", "create"],
        list: { filters: ["team_id"] },
        get: { include: ["messages"] }
      },
      messages: {
        entity: "Message",
        operations: ["list", "get", "create"],
        list: { filters: ["channel_id", "author_id", "pinned"], sortable: ["created_at"] }
      },
      feed: { entity: "Message", operations: ["get"] }
    },
    app
  };
  patch(raw);
  return parseModel(raw);
}

const codesOf = (m: Model) => validateModel(m).map(d => `${d.code}:${d.path}`);

describe("detail pages, sections and the tenant context", () => {
  const channelPage = {
    kind: "detail",
    resource: "channels",
    path: "/channels/:id",
    sections: [
      {
        resource: "messages",
        filter: { channel_id: "{row.id}" },
        order: [["created_at", "desc"]],
        limit: 50,
        create: true
      }
    ]
  };
  const sidebar = { items: [{ page: "channels" }] };

  it("compiles a detail page inside its list, its sections and the tenant context", () => {
    const app = {
      pages: {
        channels: { resource: "channels", layout: "table", filter: { team_id: "{tenant.id}" }, access: "role:admin" },
        channel: channelPage,
        author: {
          kind: "detail",
          resource: "users",
          access: "public",
          sections: [{ resource: "messages", title: "Posts", filter: { author_id: "{row.id}", pinned: true } }]
        },
        home: {
          kind: "dashboard",
          path: "/",
          tiles: [{ resource: "channels", filter: { team_id: "{tenant.id}" } }],
          recent: [{ resource: "channels", filter: { team_id: "{tenant.id}" } }]
        }
      },
      sidebar
    };
    // role:admin needs a role field on User, and the public author page lists messages that are not public
    expect(codesOf(desk(app)).sort()).toEqual([
      "M091:app.pages.channels.access",
      "M092:app.pages.author.sections[0].resource"
    ]);
    const ir = compile(
      desk(app, m => {
        m.entities.User.fields.role = {
          type: "enum",
          enum_values: ["admin", "member"],
          required: true,
          default: "member"
        };
        m.entities.Message.rules.read = "public";
      })
    );
    const channel = ir.app!.pages.find(p => p.name === "channel")!;
    expect(channel).toMatchObject({
      kind: "detail",
      resource: "channels",
      entity: "Channel",
      path: "/channels/:id",
      listPage: "channels",
      access: { kind: "role", value: "admin" },
      columns: []
    });
    expect(channel.fields).toEqual(["id", "team_id", "name"]);
    expect(channel.sections).toEqual([
      {
        resource: "messages",
        entity: "Message",
        title: "Messages",
        filter: { channel_id: { row: "id" } },
        columns: ["body", "pinned", "created_at"],
        order: ["created_at", "desc"],
        limit: 50,
        create: true
      }
    ]);
    expect(ir.app!.pages.find(p => p.name === "channels")).toMatchObject({
      detailPage: "channel",
      filter: { team_id: { tenant: "id" } }
    });
    const author = ir.app!.pages.find(p => p.name === "author")!;
    expect(author).toMatchObject({ path: "/author/:id", access: { kind: "public" } });
    expect(author.listPage).toBeUndefined();
    expect(author.sections[0]).toMatchObject({
      title: "Posts",
      limit: 10,
      create: false,
      columns: ["body", "created_at"]
    });
    expect(author.sections[0].order).toBeUndefined();
    expect(author.sections[0].filter).toEqual({ author_id: { row: "id" }, pinned: true });
    const home = ir.app!.pages.find(p => p.name === "home")!;
    expect(home.recent).toEqual([{ resource: "channels", limit: 5, filter: { team_id: { tenant: "id" } } }]);
    expect(ir.app!.tenant).toEqual({ resource: "teams", entity: "Team", labelColumn: "name" });
    expect(compile(desk({ pages: { channels: { resource: "channels" } } })).app!.tenant).toBeUndefined();
  });

  it("checks where a parameter may stand, what a detail page may carry and who names it", () => {
    const pages = (extra: Record<string, unknown>) =>
      desk({ pages: { channels: { resource: "channels" }, ...extra }, sidebar });
    expect(codesOf(pages({ odd: { resource: "users", path: "/people/:id" } }))).toEqual(["M095:app.pages.odd.path"]);
    for (const path of ["/:id", "/channel/:slug", "/:id/channel", "/channel/:id/:id", "/channel"])
      expect(codesOf(pages({ channel: { kind: "detail", resource: "channels", path } }))).toEqual([
        "M095:app.pages.channel.path"
      ]);
    expect(codesOf(pages({ person: { kind: "detail", resource: "users", path: "/channels/:id" } }))).toEqual([
      "M085:app.pages.person.path"
    ]);
    expect(codesOf(pages({ shell: { kind: "detail", resource: "users", path: "/settings/:id" } }))).toEqual([
      "M084:app.pages.shell.path"
    ]);
    expect(
      codesOf(pages({ channel: { kind: "detail", resource: "channels", path: "/channels/:id", access: "public" } }))
    ).toEqual(["M091:app.pages.channel.access"]);
    expect(codesOf(pages({ message: { kind: "detail", resource: "feed", fields: ["body", "nope"] } }))).toEqual([
      "M083:app.pages.message.fields"
    ]);
    expect(codesOf(pages({ member: { kind: "detail", resource: "members" } }))).toEqual([]);
    expect(codesOf(pages({ team: { kind: "detail", resource: "teams", access: "public" } }))).toEqual([
      "M092:app.pages.team.resource"
    ]);
    const listed = desk({
      pages: { channels: { resource: "channels" }, channel: channelPage },
      sidebar: { items: [{ page: "channel" }] }
    });
    expect(codesOf(listed)).toEqual(["M096:app.sidebar.items[0]"]);
    for (const page of [
      { kind: "detail", resource: "channels", layout: "table" },
      { kind: "detail", resource: "channels", columns: ["name"] },
      { kind: "detail", resource: "channels", filter: { team_id: "x" } },
      { kind: "detail", path: "/channels/:id" },
      { resource: "channels", sections: [] },
      { kind: "dashboard", sections: [] }
    ])
      expect(() => pages({ bad: page })).toThrow();
  });

  it("checks a section's resource, filter, order, create and columns", () => {
    const section = (s: Record<string, unknown>, resource = "channels") =>
      codesOf(
        desk({
          pages: { channels: { resource: "channels" }, one: { kind: "detail", resource, sections: [s] } },
          sidebar
        })
      );
    const where = "app.pages.one.sections[0]";
    expect(section({ resource: "messages", filter: { channel_id: "{row.id}" } })).toEqual([]);
    expect(section({ resource: "nope", filter: { channel_id: "{row.id}" } })).toEqual([`M097:${where}.resource`]);
    expect(section({ resource: "feed", filter: { channel_id: "{row.id}" } })).toEqual([`M097:${where}.resource`]);
    expect(section({ resource: "messages", filter: { pinned: true } })).toEqual([`M097:${where}.filter`]);
    expect(section({ resource: "messages", filter: { author_id: "{row.id}" } })).toEqual([`M097:${where}.filter`]);
    expect(section({ resource: "messages", filter: { channel_id: "{row.id}", body: "x" } })).toEqual([
      `M089:${where}.filter`
    ]);
    expect(section({ resource: "messages", filter: { channel_id: "{row.name}" } })).toEqual([
      `M089:${where}.filter`,
      `M097:${where}.filter`
    ]);
    expect(section({ resource: "messages", filter: { channel_id: "{row.id}", author_id: "{actor.id}" } })).toEqual([]);
    expect(section({ resource: "messages", filter: { channel_id: "{row.id}" }, order: [["body", "asc"]] })).toEqual([
      `M097:${where}.order`
    ]);
    expect(
      section({
        resource: "messages",
        filter: { channel_id: "{row.id}" },
        order: [
          ["created_at", "asc"],
          ["created_at", "desc"]
        ]
      })
    ).toEqual([`M097:${where}.order`]);
    expect(section({ resource: "members", filter: { team_id: "{row.id}" }, create: true }, "teams")).toEqual([
      `M097:${where}.create`
    ]);
    expect(section({ resource: "messages", filter: { channel_id: "{row.id}" }, columns: ["body", "nope"] })).toEqual([
      `M083:${where}.columns`
    ]);
    expect(() => section({ resource: "messages" })).toThrow();
    expect(() => section({ resource: "messages", filter: { channel_id: "{row.id}" }, limit: 201 })).toThrow();
    // {row.id} has no row outside a section
    expect(
      codesOf(
        desk({
          pages: { messages: { resource: "messages", filter: { channel_id: "{row.id}" } } },
          sidebar: { items: [] }
        })
      )
    ).toEqual(["M089:app.pages.messages.filter"]);
  });

  it("checks what {tenant.id} needs: tenancy, a relation to the tenant, a resource that lists it, a sidebar", () => {
    const scoped = { channels: { resource: "channels", filter: { team_id: "{tenant.id}" } } };
    expect(codesOf(desk({ pages: scoped, sidebar }))).toEqual([]);
    expect(codesOf(desk({ pages: { teams: { resource: "teams" }, ...scoped }, sidebar }))).toEqual([]);
    expect(codesOf(desk({ pages: scoped }))).toEqual(["M098:app.pages.channels.filter"]);
    expect(codesOf(desk({ pages: scoped, sidebar }, m => (m.resources.teams.operations = ["get", "create"])))).toEqual([
      "M098:app.pages.channels.filter"
    ]);
    expect(
      codesOf(
        desk({
          pages: { members: { resource: "members", filter: { user_id: "{tenant.id}" } } },
          sidebar: { items: [] }
        })
      )
    ).toEqual(["M098:app.pages.members.filter"]);
    const untenanted = desk({ pages: scoped, sidebar }, m => {
      delete m.auth.tenancy;
      for (const e of ["Team", "TeamMember", "Channel", "Message"]) m.entities[e].rules = { read: "authenticated" };
    });
    expect(codesOf(untenanted)).toEqual(["M098:app.pages.channels.filter"]);
    const open = desk(
      { pages: { channels: { resource: "channels", access: "public", filter: { team_id: "{tenant.id}" } } }, sidebar },
      m => (m.entities.Channel.rules.read = "public")
    );
    expect(codesOf(open)).toEqual(["M092:app.pages.channels.filter"]);
  });

  it("keeps sections and recent filters consistent through field renames and removals", () => {
    const base = desk({
      pages: {
        channels: { resource: "channels" },
        channel: {
          kind: "detail",
          resource: "channels",
          path: "/channels/:id",
          sections: [
            {
              resource: "messages",
              filter: { channel_id: "{row.id}", pinned: true },
              columns: ["body", "created_at"],
              order: [["created_at", "desc"]]
            }
          ]
        },
        home: { kind: "dashboard", path: "/", recent: [{ resource: "messages", filter: { pinned: true } }] }
      },
      sidebar
    });
    const diff = (ops: unknown[]) => applyDiff(base, parseDiff({ osl: "1.0", ops })).model.app!.pages;
    const renamed = diff([
      { op: "rename_field", entity: "Message", from: "created_at", to: "sent_at" },
      { op: "rename_field", entity: "Message", from: "pinned", to: "kept" }
    ]);
    expect(renamed.channel.sections![0]).toMatchObject({
      filter: { channel_id: "{row.id}", kept: true },
      columns: ["body", "sent_at"],
      order: [["sent_at", "desc"]]
    });
    expect(renamed.home.recent![0].filter).toEqual({ kept: true });
    const removed = diff([
      { op: "remove_field", entity: "Message", name: "created_at" },
      { op: "remove_field", entity: "Message", name: "pinned" }
    ]);
    expect(removed.channel.sections![0]).toEqual({
      resource: "messages",
      filter: { channel_id: "{row.id}" },
      columns: ["body"]
    });
    expect(removed.home.recent![0].filter).toEqual({});
    expect(() => diff([{ op: "remove_resource", name: "messages" }])).toThrow(/in a section/);
  });
});
