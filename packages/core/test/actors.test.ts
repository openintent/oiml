import { describe, expect, it } from "vitest";
import { Model, compile, provisionFields, validateModel } from "../src/index.js";

/** A model with credentials auth and a role on the identity */
function demo(actors: Record<string, Record<string, unknown>>) {
  return Model.parse({
    osl: "1.0",
    name: "demo",
    entities: {
      User: {
        fields: {
          id: { type: "uuid", primary: true },
          email: { type: "string", required: true, unique: true, validate: { format: "email" } },
          name: { type: "string", required: true },
          role: { type: "enum", enum_values: ["member", "admin"], required: true, default: "member" }
        },
        rules: { read: "public", update: "owner:id", delete: "role:admin" }
      }
    },
    auth: { identity: "User", provider: "credentials" },
    resources: { users: { entity: "User", operations: ["list", "get"] } },
    examples: { actors }
  });
}

const alice = { email: "alice@example.com", password: "alice-pass-1", name: "Alice" };
const admin = { email: "admin@example.com", password: "admin-pass-1", name: "Admin", role: "admin" };

describe("actors that carry a role", () => {
  it("role is the identity field register refuses but an actor may carry", () => {
    expect(provisionFields(demo({}))).toEqual(["role"]);
  });

  it("validates and splits the actor into register fields and provisioned columns", () => {
    const model = demo({ alice, admin });
    expect(validateModel(model).filter(d => d.code === "M075" || d.code === "M076")).toEqual([]);
    const actors = compile(model).examples.actors;
    expect(actors.alice).toEqual({ ...alice, fields: { name: "Alice" }, provisioned: {}, name: undefined });
    expect(actors.admin.fields).toEqual({ name: "Admin" });
    expect(actors.admin.provisioned).toEqual({ role: "admin" });
  });

  it("rejects a role value the enum does not have", () => {
    const problems = validateModel(demo({ alice, admin: { ...admin, role: "owner" } })).filter(d => d.code === "M076");
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("must be one of member, admin");
    expect(problems[0].path).toBe("examples.actors.admin.role");
  });

  it("still rejects a field that is neither accepted by register nor provisionable", () => {
    const problems = validateModel(demo({ alice: { ...alice, banned: true } })).filter(d => d.code === "M075");
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("cannot provision either (only role)");
  });
});
