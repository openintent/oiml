import { describe, expect, it } from "vitest";
import { Model, compile } from "@osl/core";
import { rowOp, verdict, type Session } from "../src/rules.js";

/** Tasks in a team's project: read by anyone when the project is public, by their assignee, by the team's admins */
const model = (isolation?: "database") =>
  Model.parse({
    osl: "1.0",
    name: "work",
    entities: {
      User: {
        fields: { id: { type: "uuid", primary: true }, email: { type: "string", required: true, unique: true } },
        rules: { read: "authenticated" }
      },
      Team: { fields: { id: { type: "uuid", primary: true } }, rules: { read: "member:id", create: "authenticated" } },
      TeamMember: {
        fields: {
          id: { type: "uuid", primary: true },
          team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
          user_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
          role: { type: "enum", enum_values: ["owner", "admin", "member"], required: true, default: "member" }
        },
        unique: [["team_id", "user_id"]],
        rules: { read: "member:team_id", create: "member:team_id:admin" }
      },
      Project: {
        fields: {
          id: { type: "uuid", primary: true },
          team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
          public: { type: "boolean", required: true, default: false }
        },
        rules: { read: "member:team_id", create: "member:team_id" }
      },
      Task: {
        fields: {
          id: { type: "uuid", primary: true },
          project_id: { type: "uuid", required: true, relation: { entity: "Project", on_delete: "cascade" } },
          assignee_id: { type: "uuid", relation: { entity: "User", on_delete: "set_null" } }
        },
        rules: {
          read: "public when project_id.public = true or owner:assignee_id or member:project_id.team_id:admin",
          create: "member:project_id.team_id",
          update: "owner:assignee_id or member:project_id.team_id:admin"
        }
      }
    },
    auth: {
      identity: "User",
      providers: ["credentials"],
      tenancy: { entity: "Team", membership: "TeamMember", role_field: "role", creator_role: "owner", isolation }
    }
  });

const roles = ["owner", "admin", "member"];
const session = (id: string, memberships: Session["memberships"]): Session => ({ id, user: { id }, memberships });
const row = { id: "t1", assignee_id: "bob", "project_id.team_id": "acme", "project_id.public": false };

describe("what the harness predicts under isolation: database", () => {
  const task = compile(model("database")).entities.find(e => e.name === "Task")!;
  const plain = compile(model()).entities.find(e => e.name === "Task")!;

  it("refuses an owner who is not a member of the row's tenant, where the rules alone allowed them", () => {
    const outsider = session("bob", []);
    expect(verdict(plain.rules.read, outsider, row, roles)).toEqual({ ok: true });
    expect(verdict(task.rules.read, outsider, row, roles)).toEqual({ ok: false, status: 403 });
    expect(verdict(task.rules.update, outsider, row, roles)).toEqual({ ok: false, status: 403 });
    const member = session("bob", [{ tenant: "acme", role: "member" }]);
    expect(verdict(task.rules.read, member, row, roles)).toEqual({ ok: true });
    expect(verdict(task.rules.update, member, row, roles)).toEqual({ ok: true });
    // A member who is neither the assignee nor an admin is refused as before
    expect(verdict(task.rules.read, session("carol", [{ tenant: "acme", role: "member" }]), row, roles)).toEqual({
      ok: false,
      status: 403
    });
    expect(verdict(task.rules.read, session("carol", [{ tenant: "acme", role: "admin" }]), row, roles)).toEqual({
      ok: true
    });
  });

  it("keeps the public alternative for everyone, and its statuses for a caller without a session", () => {
    const open = { ...row, "project_id.public": true };
    expect(verdict(task.rules.read, null, open, roles)).toEqual({ ok: true });
    expect(verdict(task.rules.read, session("dave", []), open, roles)).toEqual({ ok: true });
    expect(verdict(task.rules.read, null, row, roles)).toEqual({ ok: false, status: 401 });
    // Reading is all the public alternative opens: an outsider's update of a public row is the rule's refusal
    expect(rowOp(task.rules.update, task, session("bob", []), open, roles, false)).toEqual({
      allow: false,
      status: 403
    });
    expect(rowOp(task.rules.update, task, null, open, roles, false)).toEqual({ allow: false, status: 401 });
  });
});
