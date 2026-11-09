import { describe, expect, it } from "vitest";
import type { RuleIR } from "@osl/core";
import { verdict, type Session } from "../src/rules.js";

const alice: Session = { id: "a1", user: { id: "a1" }, memberships: [] };
const through = {
  relation: "members",
  entity: "ChannelMember",
  table: "channel_members",
  column: "channel_id",
  memberColumn: "user_id",
  roleColumn: "role",
  roles: ["admin", "member"]
};
const member: RuleIR = { kind: "member", field: "id", through };
const admin: RuleIR = { kind: "member", field: "id", role: "admin", through };
const viaChannel: RuleIR = {
  kind: "member",
  field: "id",
  via: [{ column: "channel_id", entity: "Channel", table: "channels", targetColumn: "id" }],
  through
};

describe("the harness's verdict for a membership relation", () => {
  it("reads the caller's membership under the predicate's key and ranks it by the junction's roles", () => {
    expect(verdict(member, null, { members: "member" }, [])).toEqual({ ok: false, status: 401 });
    expect(verdict(member, alice, null, [])).toEqual({ ok: true });
    expect(verdict(member, alice, { members: null }, [])).toEqual({ ok: false, status: 403 });
    expect(verdict(member, alice, { members: "member" }, [])).toEqual({ ok: true });
    expect(verdict(admin, alice, { members: "member" }, [])).toEqual({ ok: false, status: 403 });
    expect(verdict(admin, alice, { members: "admin" }, [])).toEqual({ ok: true });
    expect(verdict(viaChannel, alice, { "channel_id.members": "admin" }, [])).toEqual({ ok: true });
    expect(verdict(viaChannel, alice, { "channel_id.members": null, id: "x" }, [])).toEqual({ ok: false, status: 403 });
  });

  it("treats a junction without a ranked enum as all or nothing", () => {
    const plain: RuleIR = {
      kind: "member",
      field: "id",
      through: { ...through, roleColumn: undefined, roles: undefined }
    };
    expect(verdict(plain, alice, { members: true }, [])).toEqual({ ok: true });
    expect(verdict(plain, alice, { members: null }, [])).toEqual({ ok: false, status: 403 });
  });
});
