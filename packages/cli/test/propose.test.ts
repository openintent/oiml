import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Model, applyDiff, fromYaml, parseDiff } from "@osl/core";
import { validateCandidate } from "../src/propose.js";

const FIXTURE = path.resolve(__dirname, "../../../fixtures/blog/intents");

async function modelAfter(...ids: string[]) {
  let model = Model.parse({ osl: "1.0", name: "blog", entities: {} });
  for (const id of ids) {
    const diff = parseDiff(fromYaml(await readFile(path.join(FIXTURE, id, "diff.yaml"), "utf8")));
    model = applyDiff(model, diff).model;
  }
  return model;
}

describe("propose validation", () => {
  it("rejects YAML that is not a diff, with the path", async () => {
    const model = await modelAfter("FEAT-1");
    expect(validateCandidate(model, "osl: '1.0'\nops: []\n").problems[0]).toMatch(/ops/);
    expect(validateCandidate(model, "ops: [\n").problems[0]).toMatch(/not valid YAML/);
    const unknownOp = validateCandidate(model, "osl: '1.0'\nops:\n  - op: add_table\n    name: X\n");
    expect(unknownOp.problems.join(" ")).toMatch(/op/);
  });

  it("rejects diffs that apply but produce an invalid model", async () => {
    const model = await modelAfter("FEAT-1");
    const result = validateCandidate(
      model,
      [
        "osl: '1.0'",
        "ops:",
        "  - op: add_entity",
        "    name: Comment",
        "    entity:",
        "      fields:",
        "        id: { type: uuid, primary: true }",
        "        post_id: { type: uuid, required: true, relation: { entity: Post } }",
        ""
      ].join("\n")
    );
    expect(result.diff).toBeDefined();
    expect(result.problems.join("\n")).toMatch(/relation target Post does not exist/);
  });

  it("rejects diffs that fail apply-time checks", async () => {
    const model = await modelAfter("FEAT-1");
    const result = validateCandidate(
      model,
      "osl: '1.0'\nops:\n  - op: add_resource\n    name: users\n    resource: { entity: User, operations: [list] }\n"
    );
    expect(result.problems[0]).toMatch(/already exists/);
  });

  it("accepts the fixture's own next diff", async () => {
    const model = await modelAfter("FEAT-1");
    const yaml = await readFile(path.join(FIXTURE, "FEAT-2", "diff.yaml"), "utf8");
    const result = validateCandidate(model, yaml);
    expect(result.problems).toEqual([]);
    expect(result.diff?.ops.length).toBe(6);
  });
});
