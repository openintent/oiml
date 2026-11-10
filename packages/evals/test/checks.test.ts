import path from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDiff, compile, fromYaml, parseDiff } from "@osl/core";
import { loadCases, type Case } from "../src/cases.js";
import { checkExpectations, ruleMatches, scenarioMetrics } from "../src/checks.js";
import { baseModel } from "../src/runner.js";
import { normalizeProblem } from "../src/report.js";

const REPO = path.resolve(__dirname, "../../..");
const CASES = path.join(REPO, "evals/propose/cases");

async function checkedWith(c: Case, yaml: string) {
  const base = await baseModel(REPO, c);
  const diff = parseDiff(fromYaml(yaml));
  const model = applyDiff(base, diff).model;
  return { base, model, ir: compile(model), diff };
}

describe("eval corpus", () => {
  it("loads every case and each oracle diff satisfies its own expectations", async () => {
    const cases = await loadCases(CASES);
    expect(cases.length).toBeGreaterThan(40);
    const oracles = cases.filter(c => c.oracle);
    expect(oracles.length).toBe(46);
    for (const c of oracles) {
      const yaml = await readFile(path.join(REPO, c.oracle!), "utf8");
      const checked = await checkedWith(c, yaml);
      expect(checkExpectations(c.expect, checked), c.id).toEqual([]);
    }
  });

  it("a do-nothing diff fails every case except the ones that ask for nothing new", async () => {
    const cases = (await loadCases(CASES)).filter(c => c.expect.outcome === "ok");
    const passing: string[] = [];
    for (const c of cases) {
      const checked = await checkedWith(c, 'osl: "1.0"\nops: [{ op: set_description, description: nothing }]\n');
      if (checkExpectations(c.expect, checked).length === 0) passing.push(c.id);
    }
    // blog2-vague bounds the diff size only; ws2-cascade-team asks for what the fixture already has
    expect(passing.sort()).toEqual(["blog2-vague", "ws2-cascade-team"]);
  });

  it("reports what is wrong, naming the construct", async () => {
    const cases = await loadCases(CASES);
    const c = cases.find(x => x.id === "fx-blog-2-posts")!;
    const checked = await checkedWith(
      c,
      [
        'osl: "1.0"',
        "ops:",
        "  - op: add_entity",
        "    name: Post",
        "    entity:",
        "      fields:",
        "        id: { type: uuid, primary: true }",
        "        title: { type: string, required: true }",
        "        published: { type: boolean, required: true, default: true }",
        "        author_id: { type: uuid, required: true, relation: { entity: User } }",
        "  - op: add_resource",
        "    name: posts",
        "    resource: { entity: Post, operations: [list, get] }"
      ].join("\n")
    );
    const failures = checkExpectations(c.expect, checked);
    expect(failures).toContain("field Post.content missing");
    expect(failures).toContain("field Post.published.default is true, expected false");
    expect(failures.some(f => f.startsWith("unique Post("))).toBe(true);
    expect(failures).toContain("resource posts lacks create");
    expect(failures).toContain("event Post.created missing");
    expect(failures.some(f => f.includes("scenarios"))).toBe(true);
  });

  it("looks for an actor that carries the provisioned fields an admin scenario needs", async () => {
    const cases = await loadCases(CASES);
    const c = cases.find(x => x.id === "fx-blog-5-publishing")!;
    const checked = await checkedWith(c, await readFile(path.join(REPO, c.oracle!), "utf8"));
    expect(checked.ir.examples.actors.admin.provisioned).toEqual({ role: "admin" });
    expect(checked.ir.examples.actors.admin.fields).toEqual({ name: "Admin" });
    expect(checkExpectations({ outcome: "ok", actor_fields: { role: "admin|superuser" } }, checked)).toEqual([]);
    expect(checkExpectations({ outcome: "ok", actor_fields: { role: "owner" } }, checked)).toEqual([
      "no actor sets role: owner"
    ]);
  });

  it("holds an ask for invites to the construct, not to an entity declared by hand", async () => {
    const cases = await loadCases(CASES);
    const c = cases.find(x => x.id === "ws1-invites-gap")!;
    const declared = await checkedWith(
      c,
      [
        'osl: "1.0"',
        "ops:",
        "  - op: set_auth",
        "    auth:",
        "      identity: User",
        "      providers: [credentials]",
        "      tenancy: { entity: Team, membership: TeamMember, role_field: role, creator_role: owner }",
        "      invites: { TeamMember: {} }",
        "  - op: add_scenario",
        "    scenario:",
        "      name: invite by email",
        "      steps:",
        "        - as: alice",
        "          op: teams.create",
        "          body: { name: Harbor }",
        "          expect: { status: 201 }",
        "          capture: { team: data.id }",
        "        - as: bob",
        "          op: team_invites.create",
        '          body: { team_id: "{team}", email: stranger@example.com }',
        "          expect: { status: 403 }",
        "        - as: alice",
        "          op: team_invites.create",
        '          body: { team_id: "{team}", email: bob@example.com }',
        "          expect: { status: 201 }",
        "          capture: { token: debug.token }",
        "        - as: bob",
        "          op: auth.invite_accept",
        '          path: { token: "{token}" }',
        "          expect: { status: 200 }"
      ].join("\n")
    );
    // The stored model keeps the one key; the invite entity is the compiler's and is not in it
    expect(Object.keys(declared.model.entities)).not.toContain("TeamInvite");
    expect(declared.ir.entities.map(e => e.name)).toContain("TeamInvite");
    expect(checkExpectations(c.expect, declared)).toEqual([]);

    const byHand = await checkedWith(
      c,
      [
        'osl: "1.0"',
        "ops:",
        "  - op: add_entity",
        "    name: Invitation",
        "    entity:",
        "      fields:",
        "        id: { type: uuid, primary: true }",
        "        team_id: { type: uuid, required: true, relation: { entity: Team, on_delete: cascade } }",
        "        email: { type: string, required: true, validate: { format: email } }",
        '      rules: { read: "member:team_id:admin", create: "member:team_id:admin", delete: "member:team_id:admin" }',
        "  - op: add_resource",
        "    name: invitations",
        "    resource: { entity: Invitation, operations: [list, create, delete], list: { filters: [team_id] } }"
      ].join("\n")
    );
    const failures = checkExpectations(c.expect, byHand);
    expect(failures).toContain("auth.invites has no entry for TeamMember");
    expect(failures.some(f => f.startsWith("entity ") && f.endsWith("should be gone"))).toBe(true);
    expect(checkExpectations({ outcome: "ok", auth: { invites: ["ProjectMember"] } }, declared)).toEqual([
      "auth.invites has no entry for ProjectMember (it has TeamMember)"
    ]);
  });

  it("counts the scenarios a diff adds and what they touch", async () => {
    const cases = await loadCases(CASES);
    const c = cases.find(x => x.id === "fx-blog-2-posts")!;
    const checked = await checkedWith(c, await readFile(path.join(REPO, c.oracle!), "utf8"));
    const m = scenarioMetrics(checked);
    expect(m.scenarios).toBeGreaterThan(0);
    expect(m.rejections).toBeGreaterThan(0);
    expect(m.added).toContain("posts");
    expect(m.touched).toContain("posts");
  });

  it("groups validation problems by shape", () => {
    expect(normalizeProblem("M010 relation target Post does not exist")).toBe(
      normalizeProblem("M010 relation target Category does not exist")
    );
    expect(normalizeProblem('entities.Comment.fields.post_id: Unrecognized key(s) in object: "entity"')).toBe(
      normalizeProblem('entities.Like.fields.user_id: Unrecognized key(s) in object: "reverse"')
    );
  });

  it("lets an expectation without a condition accept a rule the agent qualified with one", () => {
    const conditioned = {
      kind: "any" as const,
      rules: [
        { kind: "public" as const, when: { column: "published", op: "eq" as const, value: true } },
        { kind: "owner" as const, field: "author_id" }
      ]
    };
    expect(ruleMatches("owner:author_id or public", conditioned)).toBe(true);
    expect(ruleMatches("public when published = true or owner:author_id", conditioned)).toBe(true);
    expect(ruleMatches("public when published = false or owner:author_id", conditioned)).toBe(false);
    expect(ruleMatches("owner:author_id", conditioned)).toBe(false);
    expect(
      ruleMatches("role:reviewer|role:editor", {
        kind: "role",
        value: "reviewer",
        when: { column: "status", op: "eq", value: "in_review" }
      })
    ).toBe(true);
  });
});
