import { describe, expect, it } from "vitest";
import {
  Model,
  applyDiff,
  compile,
  expandInvites,
  invitePlans,
  parseDiff,
  planMigration,
  renderPostgres,
  validateModel
} from "../src/index.js";

const id = { type: "uuid", primary: true };
const to = (entity: string, reverse?: string) => ({
  type: "uuid",
  required: true,
  relation: { entity, ...(reverse ? { reverse } : {}), on_delete: "cascade" }
});

/**
 * Teams with a tenancy membership, channels whose members carry a ranked role, and articles whose editors carry
 * none: the three shapes an invite can make a membership of
 */
const source = {
  osl: "1.0",
  name: "desk",
  auth: {
    identity: "User",
    providers: ["credentials", "magic_link"],
    tenancy: { entity: "Team", membership: "TeamMember", role_field: "role", creator_role: "owner" },
    invites: { TeamMember: {}, ChannelMember: {}, ArticleEditor: {} }
  },
  entities: {
    User: {
      fields: {
        id,
        email: { type: "string", required: true, unique: true, max_length: 200 },
        name: { type: "string", required: true }
      },
      rules: { read: "authenticated", update: "owner:id", delete: "none" }
    },
    Team: {
      fields: { id, name: { type: "string", required: true } },
      rules: { read: "member:id", create: "authenticated", update: "member:id:admin", delete: "member:id:owner" }
    },
    TeamMember: {
      fields: {
        id,
        team_id: to("Team", "members"),
        user_id: to("User", "memberships"),
        role: { type: "enum", enum_values: ["owner", "admin", "member"], required: true, default: "member" }
      },
      unique: [["team_id", "user_id"]],
      rules: {
        read: "member:team_id",
        create: "member:team_id:admin",
        update: "member:team_id:owner",
        delete: "member:team_id:admin"
      }
    },
    Channel: {
      fields: { id, name: { type: "string", required: true }, created_by: to("User") },
      rules: { read: "member:members", create: "owner:created_by", update: "owner:created_by", delete: "none" }
    },
    ChannelMember: {
      fields: {
        id,
        channel_id: to("Channel", "members"),
        user_id: to("User"),
        role: { type: "enum", enum_values: ["admin", "member"], required: true, default: "member", ranked: true }
      },
      unique: [["channel_id", "user_id"]],
      rules: {
        read: "member:channel_id.members",
        create: "owner:channel_id.created_by or member:channel_id.members:admin",
        delete: "owner:channel_id.created_by"
      }
    },
    Article: {
      fields: { id, title: { type: "string", required: true }, author_id: to("User") },
      rules: { read: "public", create: "owner:author_id", update: "owner:author_id", delete: "owner:author_id" }
    },
    ArticleEditor: {
      fields: { id, article_id: to("Article", "editors"), user_id: to("User") },
      unique: [["article_id", "user_id"]],
      rules: { read: "public", create: "owner:article_id.author_id", delete: "owner:article_id.author_id" }
    }
  },
  resources: {
    users: { entity: "User", operations: ["list", "get"] },
    teams: { entity: "Team", operations: ["list", "get", "create"] },
    members: { entity: "TeamMember", operations: ["list", "get", "delete"] },
    channels: { entity: "Channel", operations: ["list", "get", "create"] },
    articles: { entity: "Article", operations: ["list", "get", "create"] }
  }
};

type Source = typeof source;

/** The source with a change made to a copy of it */
function desk(change: (draft: Source & Record<string, any>) => void = () => {}): Model {
  const draft = structuredClone(source) as Source & Record<string, any>;
  change(draft);
  return Model.parse(draft);
}

const errorsOf = (model: Model) =>
  validateModel(model)
    .filter(d => d.level === "error")
    .map(d => `${d.code}:${d.path}`);

const messageOf = (model: Model, code: string) =>
  validateModel(model)
    .filter(d => d.code === code)
    .map(d => d.message)
    .join("\n");

describe("invites", () => {
  it("validates, and leaves the stored model as it was written", () => {
    const model = desk();
    expect(validateModel(model).filter(d => d.level === "error")).toEqual([]);
    expect(Object.keys(model.entities)).not.toContain("TeamInvite");
    expect(Object.keys(model.resources)).not.toContain("team_invites");
    // Expanding twice writes nothing more
    const expanded = expandInvites(model);
    expect(expandInvites(expanded)).toBe(expanded);
    expect(expandInvites(desk(d => delete (d.auth as any).invites))).not.toHaveProperty("entities.TeamInvite");
  });

  it("writes an invite entity and a resource for a tenancy membership", () => {
    const expanded = expandInvites(desk());
    expect(invitePlans(expanded).map(p => `${p.membership}>${p.parent}:${p.entity}:${p.table}:${p.resource}`)).toEqual([
      "TeamMember>Team:TeamInvite:team_invites:team_invites",
      "ChannelMember>Channel:ChannelInvite:channel_invites:channel_invites",
      "ArticleEditor>Article:ArticleInvite:article_invites:article_invites"
    ]);
    const invite = expanded.entities.TeamInvite;
    expect(Object.keys(invite.fields)).toEqual([
      "id",
      "team_id",
      "email",
      "role",
      "invited_by",
      "token_hash",
      "expires_at",
      "created_at"
    ]);
    expect(invite.fields.team_id).toMatchObject({ required: true, relation: { entity: "Team", on_delete: "cascade" } });
    expect(invite.fields.email).toMatchObject({ required: true, max_length: 200, validate: { format: "email" } });
    expect(invite.fields.role).toMatchObject({
      type: "enum",
      enum_values: ["owner", "admin", "member"],
      default: "member"
    });
    expect(invite.fields.invited_by).toMatchObject({ read_only: true, relation: { entity: "User", name: "inviter" } });
    expect(invite.fields.token_hash).toMatchObject({ hidden: true, unique: true });
    expect(invite.fields.expires_at).toMatchObject({ read_only: true });
    expect(invite.unique).toEqual([["team_id", "email"]]);
    // The default rule is the membership's own create rule, on every action an invite has
    expect(invite.rules).toMatchObject({
      read: "member:team_id:admin",
      create: "member:team_id:admin",
      update: "none",
      delete: "member:team_id:admin"
    });
    expect(expanded.resources.team_invites).toMatchObject({
      entity: "TeamInvite",
      operations: ["list", "get", "create", "delete"],
      list: { filters: ["team_id"], include: ["inviter"] }
    });
  });

  it("compiles each invite with its roles, its rule and its expiry", () => {
    const ir = compile(desk(d => ((d.auth.invites as any).TeamMember = { expires: "2d" })));
    const [team, channel, article] = ir.auth!.invites!;
    expect(team).toMatchObject({
      membership: "TeamMember",
      membershipTable: "team_members",
      parent: "Team",
      parentColumn: "team_id",
      userColumn: "user_id",
      roleColumn: "role",
      roles: ["owner", "admin", "member"],
      rule: { kind: "member", field: "team_id", role: "admin" },
      expires: 2 * 86_400,
      entity: "TeamInvite",
      table: "team_invites",
      resource: "team_invites"
    });
    // A ranked junction grants its own enum, and its rule walks the junction's relation
    expect(channel).toMatchObject({
      membership: "ChannelMember",
      parent: "Channel",
      parentColumn: "channel_id",
      roleColumn: "role",
      roles: ["admin", "member"],
      expires: 7 * 86_400,
      entity: "ChannelInvite"
    });
    expect(channel.rule.kind).toBe("any");
    // A junction without a role has none to grant
    expect(article).toMatchObject({ membership: "ArticleEditor", parent: "Article", entity: "ArticleInvite" });
    expect(article.roleColumn).toBeUndefined();
    expect(article.roles ?? []).toEqual([]);
    expect(article.rule).toMatchObject({
      kind: "owner",
      field: "author_id",
      via: [{ column: "article_id", entity: "Article" }]
    });
    expect(ir.entities.find(e => e.name === "ArticleInvite")!.columns.map(c => c.name)).toEqual([
      "id",
      "article_id",
      "email",
      "invited_by",
      "token_hash",
      "expires_at",
      "created_at"
    ]);

    // The create is marked, takes the parent, the address and the role, and nothing fills an owner
    const create = ir.resources.find(r => r.name === "team_invites")!.operations.find(o => o.kind === "create") as {
      invite?: string;
      fields: string[];
      ownerField?: string;
    };
    expect(create).toMatchObject({ invite: "TeamMember", fields: ["team_id", "email", "role"] });
    expect(create.ownerField).toBeUndefined();
    const plain = ir.resources.find(r => r.name === "articles")!.operations.find(o => o.kind === "create");
    expect(plain).not.toHaveProperty("invite");
    expect(compile(desk(d => delete (d.auth as any).invites)).auth!.invites ?? []).toEqual([]);
  });

  it("takes a rule of its own, read on the invite", () => {
    const model = desk(d => ((d.auth.invites as any).TeamMember = { rule: "member:team_id:owner" }));
    expect(errorsOf(model)).toEqual([]);
    expect(expandInvites(model).entities.TeamInvite.rules).toMatchObject({
      read: "member:team_id:owner",
      create: "member:team_id:owner",
      delete: "member:team_id:owner"
    });
    expect(compile(model).auth!.invites![0].rule).toEqual({ kind: "member", field: "team_id", role: "owner" });
    // A rule the invite cannot carry is reported once, where it was written
    const unknown = desk(d => ((d.auth.invites as any).TeamMember = { rule: "member:team_id:boss" }));
    expect(errorsOf(unknown).filter(e => e.endsWith("auth.invites.TeamMember.rule"))).toHaveLength(1);
  });

  it("refuses an entry that names no membership (M115)", () => {
    expect(errorsOf(desk(d => ((d.auth.invites as any).Nobody = {})))).toEqual(["M115:auth.invites.Nobody"]);
    const plain = desk(d => ((d.auth.invites as any).Article = {}));
    expect(errorsOf(plain)).toEqual(["M115:auth.invites.Article"]);
    expect(messageOf(plain, "M115")).toMatch(/Article is not a membership/);
    // The other entries still expand
    expect(invitePlans(expandInvites(plain))).toHaveLength(3);
  });

  it("refuses a membership an accept could not make (M116)", () => {
    const required = desk(d => ((d.entities.TeamMember.fields as any).title = { type: "string", required: true }));
    expect(errorsOf(required)).toEqual(["M116:auth.invites.TeamMember"]);
    expect(messageOf(required, "M116")).toMatch(/title is required and has no default/);
    expect(expandInvites(required).entities.TeamInvite).toBeUndefined();
    const defaulted = desk(
      d => ((d.entities.TeamMember.fields as any).title = { type: "string", required: true, default: "Member" })
    );
    expect(errorsOf(defaulted)).toEqual([]);

    const twice = desk(d => ((d.entities.ArticleEditor as any).unique = []));
    expect(errorsOf(twice)).toContain("M116:auth.invites.ArticleEditor");
    expect(messageOf(twice, "M116")).toMatch(/unique: \[\[article_id, user_id\]\]/);
  });

  it("refuses a rule that cannot be read on an invite, or that anyone passes (M117)", () => {
    const open = desk(d => ((d.auth.invites as any).TeamMember = { rule: "public" }));
    expect(errorsOf(open)).toEqual(["M117:auth.invites.TeamMember.rule"]);
    expect(messageOf(open, "M117")).toMatch(/lets anyone invite to any Team/);

    // A membership whose create rule names the member has no such field on the invite: the entry must say the rule
    const inherited = desk(d => (d.entities.ArticleEditor.rules.create = "owner:user_id"));
    expect(errorsOf(inherited)).toEqual(["M117:auth.invites.ArticleEditor"]);
    expect(messageOf(inherited, "M117")).toMatch(/has no user_id; it is ArticleEditor's create rule; declare rule/);
    const declared = desk(d => {
      d.entities.ArticleEditor.rules.create = "owner:user_id";
      (d.auth.invites as any).ArticleEditor = { rule: "owner:article_id.author_id" };
    });
    expect(errorsOf(declared)).toEqual([]);

    const explicit = desk(d => ((d.auth.invites as any).ArticleEditor = { rule: "owner:user_id" }));
    expect(errorsOf(explicit)).toEqual(["M117:auth.invites.ArticleEditor.rule"]);
    // The inviter is a field of the invite, so a rule may name it
    const inviter = desk(
      d => ((d.auth.invites as any).ArticleEditor = { rule: "owner:article_id.author_id or owner:invited_by" })
    );
    expect(errorsOf(inviter)).toEqual([]);
  });

  it("refuses a name the model already uses (M118)", () => {
    const entity = desk(d => ((d.entities as any).TeamInvite = { fields: { id } }));
    expect(errorsOf(entity)).toEqual(["M118:auth.invites.TeamMember"]);
    expect(messageOf(entity, "M118")).toMatch(/an entity TeamInvite, and the model declares one/);

    const table = desk(d => ((d.entities as any).Pending = { table: "team_invites", fields: { id } }));
    expect(errorsOf(table)).toEqual(["M118:auth.invites.TeamMember"]);
    expect(messageOf(table, "M118")).toMatch(/the table team_invites, which Pending uses/);

    const resource = desk(d => ((d.resources as any).team_invites = { entity: "Team", operations: ["list"] }));
    expect(errorsOf(resource)).toEqual(["M118:auth.invites.TeamMember"]);
    expect(messageOf(resource, "M118")).toMatch(/a resource team_invites, and the model declares one/);

    // Two memberships of one parent would share one invite entity
    const two = desk(d => {
      (d.entities as any).ArticleReviewer = {
        fields: { id, article_id: to("Article", "reviewers"), user_id: to("User") },
        unique: [["article_id", "user_id"]],
        rules: { read: "public", create: "owner:article_id.author_id" }
      };
      (d.auth.invites as any).ArticleReviewer = {};
    });
    expect(errorsOf(two)).toEqual(["M118:auth.invites.ArticleReviewer"]);
    expect(messageOf(two, "M118")).toMatch(/ArticleEditor and ArticleReviewer both belong to Article/);

    // A relation or role named like a field every invite has
    const clash = desk(d => {
      const fields = d.entities.ArticleEditor.fields as any;
      fields.email = fields.article_id;
      delete fields.article_id;
      (d.entities.ArticleEditor as any).unique = [["email", "user_id"]];
      d.entities.ArticleEditor.rules = { read: "public", create: "owner:email.author_id" } as any;
    });
    expect(errorsOf(clash)).toEqual(["M118:auth.invites.ArticleEditor"]);
    expect(messageOf(clash, "M118")).toMatch(/ArticleEditor.email carries a name every invite uses/);
  });

  it("keeps /invite for the shell, with or without invites (M084)", () => {
    const app = (path: string, invites = true) =>
      desk(d => {
        if (!invites) delete (d.auth as any).invites;
        d.app = { pages: { teams: { resource: "teams", path } }, sidebar: { items: [{ page: "teams" }] } };
      });
    expect(errorsOf(app("/invite"))).toEqual(["M084:app.pages.teams.path"]);
    expect(errorsOf(app("/invite/accepted"))).toEqual(["M084:app.pages.teams.path"]);
    expect(errorsOf(app("/invite", false))).toEqual(["M084:app.pages.teams.path"]);
    expect(errorsOf(app("/invites"))).toEqual([]);
  });

  it("checks the invite steps of a scenario (M121, M072)", () => {
    const steps = (list: unknown[], invites = true) =>
      desk(d => {
        if (!invites) delete (d.auth as any).invites;
        d.examples = {
          actors: { alice: { email: "alice@example.com", password: "alice-pass-1", name: "Alice" } },
          scenarios: [{ name: "invites", steps: list }]
        };
      });
    const at = (n: number) => `examples.scenarios[0].steps[${n}]`;
    const good = [
      { op: "auth.invite", path: { token: "abc" }, expect: { status: 404 } },
      {
        op: "auth.invite_accept",
        path: { token: "abc" },
        body: { name: "New", password: "new-pass-1" },
        expect: { status: 404 }
      },
      {
        op: "auth.login",
        body: { email: "alice@example.com", password: "alice-pass-1", invite: "abc" },
        expect: { status: 200 }
      }
    ];
    expect(errorsOf(steps(good))).toEqual([]);
    expect(errorsOf(steps(good, false))).toEqual([`M121:${at(0)}`, `M121:${at(1)}`, `M121:${at(2)}`]);
    expect(messageOf(steps(good, false), "M121")).toMatch(/auth.invite needs auth.invites/);
    expect(messageOf(steps(good, false), "M121")).toMatch(/invite on auth.login needs auth.invites/);
    expect(
      errorsOf(
        steps([
          { op: "auth.invite", expect: { status: 404 } },
          { op: "auth.invite_accept", expect: { status: 404 } }
        ])
      )
    ).toEqual([`M072:${at(0)}`, `M072:${at(1)}`]);
  });

  it("says an invite is a way in when the identity asks for more than a link can give (M123)", () => {
    const more = (invites: boolean) =>
      desk(d => {
        (d.entities.User.fields as any).handle = { type: "string", required: true };
        if (!invites) delete (d.auth as any).invites;
      });
    expect(messageOf(more(true), "M123")).toMatch(
      /through credentials or accept an invite, whose form asks for the fields, first/
    );
    expect(messageOf(more(false), "M123")).toMatch(/through credentials first/);
    // The accept's form asks for the same fields register does
    expect(compile(more(true)).auth!.registerFields).toEqual(["name", "handle"]);
  });

  describe("in a diff", () => {
    const evolve = (model: Model, ops: unknown[]) => {
      const applied = applyDiff(model, parseDiff({ osl: "1.0", ops }));
      const plan = planMigration(compile(model), compile(applied.model), applied.renames);
      return { ...applied, sql: renderPostgres(plan) };
    };

    it("carries invites on set_auth, and writes the invite's table", () => {
      const before = desk(d => delete (d.auth as any).invites);
      const auth = { ...structuredClone(source.auth), invites: { TeamMember: { expires: "3d" } } };
      const { model, sql } = evolve(before, [{ op: "set_auth", auth }]);
      expect(model.auth!.invites).toEqual({ TeamMember: { expires: "3d" } });
      expect(Object.keys(model.entities)).not.toContain("TeamInvite");
      expect(sql).toContain('CREATE TABLE "team_invites"');
      expect(sql).toContain('"token_hash"');
      // Taking the entry away drops the table with it
      const { sql: dropped } = evolve(model, [{ op: "set_auth", auth: { ...auth, invites: undefined } }]);
      expect(dropped).toContain('DROP TABLE "team_invites"');
    });

    it("renames the invite with its membership's parent", () => {
      const { model, renames, sql } = evolve(desk(), [{ op: "rename_entity", from: "Article", to: "Story" }]);
      expect(renames.entities).toEqual({ Article: "Story", ArticleInvite: "StoryInvite" });
      expect(invitePlans(expandInvites(model)).map(p => p.entity)).toContain("StoryInvite");
      expect(errorsOf(model)).toEqual([]);
      expect(sql).toMatch(/ALTER TABLE "article_invites" RENAME TO "story_invites"/);
      expect(sql).not.toContain('DROP TABLE "article_invites"');
    });

    it("moves the entry when the membership is renamed", () => {
      const { model, renames, sql } = evolve(desk(), [{ op: "rename_entity", from: "ArticleEditor", to: "CoAuthor" }]);
      expect(Object.keys(model.auth!.invites!)).toEqual(["TeamMember", "ChannelMember", "CoAuthor"]);
      expect(renames.entities).toEqual({ ArticleEditor: "CoAuthor" });
      expect(compile(model).auth!.invites![2]).toMatchObject({ membership: "CoAuthor", entity: "ArticleInvite" });
      expect(errorsOf(model)).toEqual([]);
      expect(sql).not.toContain("article_invites");
    });

    it("mirrors a rename of the parent relation or the role on the invite, and rewrites its rule", () => {
      const start = desk(d => ((d.auth.invites as any).TeamMember = { rule: "member:team_id:owner" }));
      const { model, renames, sql } = evolve(start, [
        { op: "rename_field", entity: "TeamMember", from: "team_id", to: "org_id" },
        { op: "rename_field", entity: "TeamMember", from: "role", to: "level" }
      ]);
      expect(renames.fields.TeamInvite).toEqual({ team_id: "org_id", role: "level" });
      expect(model.auth!.invites!.TeamMember.rule).toBe("member:org_id:owner");
      expect(model.auth!.tenancy!.role_field).toBe("level");
      expect(errorsOf(model)).toEqual([]);
      expect(compile(model).auth!.invites![0]).toMatchObject({ parentColumn: "org_id", roleColumn: "level" });
      expect(sql).toMatch(/ALTER TABLE "team_invites" RENAME COLUMN "team_id" TO "org_id"/);
      expect(sql).toMatch(/ALTER TABLE "team_invites" RENAME COLUMN "role" TO "level"/);
      expect(sql).not.toMatch(/"team_invites" DROP COLUMN/);
      // A field the invite does not carry is the membership's alone
      const other = evolve(desk(), [{ op: "rename_field", entity: "TeamMember", from: "user_id", to: "person_id" }]);
      expect(other.renames.fields.TeamInvite).toBeUndefined();
      expect(errorsOf(other.model)).toEqual([]);
    });
  });
});
