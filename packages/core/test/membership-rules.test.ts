import { describe, expect, it } from "vitest";
import { Model, compile, ruleKey, ruleMemberships, ruleText, validateModel, type RuleIR } from "../src/index.js";

/** Users, channels with their own members (a ranked enum), messages in channels, and follows between users */
const base: Model = Model.parse({
  osl: "1.0",
  name: "chat",
  entities: {
    User: {
      fields: {
        id: { type: "uuid", primary: true },
        email: { type: "string", required: true, unique: true },
        name: { type: "string", required: true }
      },
      rules: { read: "public", update: "owner:id", delete: "none" }
    },
    Channel: {
      fields: {
        id: { type: "uuid", primary: true },
        name: { type: "string", required: true },
        created_by: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } }
      },
      rules: {
        read: "member:members",
        create: "authenticated",
        update: "member:members:admin",
        delete: "member:members:admin"
      }
    },
    ChannelMember: {
      fields: {
        id: { type: "uuid", primary: true },
        channel_id: {
          type: "uuid",
          required: true,
          relation: { entity: "Channel", reverse: "members", on_delete: "cascade" }
        },
        user_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
        role: { type: "enum", enum_values: ["admin", "member"], required: true, default: "member", ranked: true }
      },
      unique: [["channel_id", "user_id"]],
      rules: {
        read: "member:channel_id.members",
        create: "owner:channel_id.created_by or member:channel_id.members:admin"
      }
    },
    Message: {
      fields: {
        id: { type: "uuid", primary: true },
        channel_id: {
          type: "uuid",
          required: true,
          relation: { entity: "Channel", reverse: "messages", on_delete: "cascade" }
        },
        author_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
        body: { type: "text", required: true }
      },
      rules: {
        read: "member:channel_id.members",
        create: "member:channel_id.members and owner:author_id",
        update: "owner:author_id",
        delete: "owner:author_id or member:channel_id.members:admin"
      }
    },
    Follow: {
      fields: {
        id: { type: "uuid", primary: true },
        follower_id: {
          type: "uuid",
          required: true,
          relation: { entity: "User", reverse: "following", on_delete: "cascade" }
        },
        followee_id: {
          type: "uuid",
          required: true,
          relation: { entity: "User", reverse: "followers", on_delete: "cascade" }
        }
      },
      unique: [["follower_id", "followee_id"]],
      rules: { read: "public", create: "owner:follower_id", delete: "owner:follower_id" }
    },
    Bulletin: {
      fields: {
        id: { type: "uuid", primary: true },
        author_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
        body: { type: "text", required: true }
      },
      rules: { read: "owner:author_id or member:author_id.followers", create: "owner:author_id" }
    }
  },
  resources: {
    channels: { entity: "Channel", operations: ["list", "get", "create", "update", "delete"] },
    messages: { entity: "Message", operations: ["list", "get", "create", "update", "delete"] }
  },
  auth: { identity: "User", providers: ["credentials"] }
});

function withRule(entity: string, op: "read" | "create" | "update" | "delete", rule: string): Model {
  const next = structuredClone(base);
  next.entities[entity].rules = { ...next.entities[entity].rules, [op]: rule };
  return next;
}

const codes = (m: Model) => validateModel(m).map(d => `${d.code}:${d.path}`);
const errors = (m: Model) => validateModel(m).filter(d => d.level === "error");

describe("member paths ending in a membership relation", () => {
  it("validates a junction with one identity relation, a ranked enum and a unique pair", () => {
    expect(errors(base)).toEqual([]);
    const warnings = validateModel(base).filter(d => d.level === "warning");
    expect(warnings.map(d => d.code)).not.toContain("M038");
  });

  it("compiles to a member predicate with the junction, keyed by the relation's name", () => {
    const ir = compile(base);
    const message = ir.entities.find(e => e.name === "Message")!;
    const read = message.rules.read as Extract<RuleIR, { kind: "member" }>;
    expect(read.kind).toBe("member");
    expect(read.field).toBe("id");
    expect(read.via?.map(h => h.entity)).toEqual(["Channel"]);
    expect(read.through).toEqual({
      relation: "members",
      entity: "ChannelMember",
      table: "channel_members",
      column: "channel_id",
      memberColumn: "user_id",
      roleColumn: "role",
      roles: ["admin", "member"]
    });
    expect(ruleKey(read)).toBe("channel_id.members");
    expect(ruleText(read)).toBe("member:channel_id.members");
    expect([...ruleMemberships(message.rules.delete).keys()]).toEqual(["channel_id.members"]);
    const channel = ir.entities.find(e => e.name === "Channel")!;
    const own = channel.rules.read as Extract<RuleIR, { kind: "member" }>;
    expect(own.via).toBeUndefined();
    expect(ruleKey(own)).toBe("members");
    expect(ruleText(channel.rules.update)).toBe("member:members:admin");
  });

  it("picks the junction's other identity relation when the path arrives through the identity", () => {
    const ir = compile(base);
    const bulletin = ir.entities.find(e => e.name === "Bulletin")!;
    const read = bulletin.rules.read as Extract<RuleIR, { kind: "any" }>;
    const followers = read.rules[1] as Extract<RuleIR, { kind: "member" }>;
    expect(followers.through).toMatchObject({ entity: "Follow", column: "followee_id", memberColumn: "follower_id" });
    expect(followers.through?.roleColumn).toBeUndefined();
    expect(ruleText(bulletin.rules.read)).toBe("owner:author_id or member:author_id.followers");
  });

  it("leaves tenancy's member rules as they were", () => {
    const tenancy: Model = Model.parse({
      ...base,
      entities: {
        ...base.entities,
        Team: {
          fields: { id: { type: "uuid", primary: true }, name: { type: "string", required: true } },
          rules: { read: "member:id" }
        },
        TeamMember: {
          fields: {
            id: { type: "uuid", primary: true },
            team_id: {
              type: "uuid",
              required: true,
              relation: { entity: "Team", reverse: "team_members", on_delete: "cascade" }
            },
            user_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
            role: { type: "enum", enum_values: ["owner", "member"], required: true, default: "member" }
          },
          unique: [["team_id", "user_id"]]
        },
        Project: {
          fields: {
            id: { type: "uuid", primary: true },
            team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } }
          },
          rules: { read: "member:team_id", update: "member:team_id:owner" }
        }
      },
      auth: {
        identity: "User",
        providers: ["credentials"],
        tenancy: { entity: "Team", membership: "TeamMember", role_field: "role", creator_role: "owner" }
      }
    });
    expect(errors(tenancy)).toEqual([]);
    const ir = compile(tenancy);
    const project = ir.entities.find(e => e.name === "Project")!;
    const read = project.rules.read as Extract<RuleIR, { kind: "member" }>;
    expect(read.through).toBeUndefined();
    expect(read.field).toBe("team_id");
    expect(ruleKey(read)).toBe("team_id");
  });

  it("refuses what is not a membership, a role without a ranked enum, and two ranked enums", () => {
    // A junction with two relations to the identity, reached through a non-identity relation: which one is the member?
    const twoUsers = structuredClone(base);
    twoUsers.entities.ChannelMember.fields.invited_by = {
      type: "uuid",
      relation: { entity: "User", on_delete: "set_null" }
    };
    expect(codes(twoUsers)).toContain("M036:entities.Channel.rules.read");
    // Reached through the identity, a two-identity junction is fine: the other relation is the member
    expect(errors(withRule("User", "update", "owner:id or member:following"))).toEqual([]);
    // A reverse relation whose entity has no relation to the identity
    const tagged = structuredClone(base);
    tagged.entities.Tag = {
      fields: {
        id: { type: "uuid", primary: true },
        channel_id: {
          type: "uuid",
          required: true,
          relation: { entity: "Channel", reverse: "tags", on_delete: "cascade" }
        },
        label: { type: "string", required: true }
      }
    };
    tagged.entities.Channel.rules = { ...tagged.entities.Channel.rules, update: "member:tags" };
    expect(codes(tagged)).toContain("M036:entities.Channel.rules.update");
    // A reverse relation whose entity reaches the identity is a membership, even an odd one (authors of messages)
    expect(errors(withRule("Channel", "update", "member:messages"))).toEqual([]);
    // A role where the junction has no ranked enum
    expect(codes(withRule("Bulletin", "read", "member:author_id.followers:admin"))).toContain(
      "M037:entities.Bulletin.rules.read"
    );
    // A role the ranked enum lacks
    expect(codes(withRule("Message", "delete", "member:channel_id.members:owner"))).toContain(
      "M037:entities.Message.rules.delete"
    );
    // Neither a field nor a reverse relation
    expect(codes(withRule("Message", "read", "member:channel_id.people"))).toContain(
      "M020:entities.Message.rules.read"
    );
    // A tenant-field member rule still needs tenancy
    expect(codes(withRule("Message", "read", "member:channel_id"))).toContain("M024:entities.Message.rules.read");
    const twoRanked = structuredClone(base);
    twoRanked.entities.ChannelMember.fields.level = { type: "enum", enum_values: ["a", "b"], ranked: true };
    expect(codes(twoRanked)).toContain("M039:entities.ChannelMember");
    const noUnique = structuredClone(base);
    delete noUnique.entities.ChannelMember.unique;
    expect(
      validateModel(noUnique)
        .filter(d => d.level === "warning")
        .map(d => d.code)
    ).toContain("M038");
  });

  it("refuses ranked on a field that is not an enum", () => {
    const wrong = structuredClone(base);
    (wrong.entities.ChannelMember.fields as Record<string, unknown>).note = { type: "string", ranked: true };
    expect(() => Model.parse(wrong)).toThrow(/ranked only applies to enum fields/);
  });
});
