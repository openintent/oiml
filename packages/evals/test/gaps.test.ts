import { describe, expect, it } from "vitest";
import { clusterGaps, collectGaps, gapReport, gapTopic, normalizeGapText } from "../src/gaps.js";
import type { CaseResult, RunResult } from "../src/runner.js";

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function caseResult(id: string, over: Partial<CaseResult>): CaseResult {
  return {
    id,
    tags: [],
    base: "empty",
    status: "ok",
    expected_outcome: "any",
    not_delivered: [],
    pass: true,
    attempts: 1,
    ms: 0,
    usage,
    cost_usd: 0,
    ops: 1,
    op_kinds: ["add_entity"],
    adds_actions: false,
    attempt_log: [],
    failures: [],
    metrics: null,
    generate: {},
    ...over
  };
}

const run: RunResult = {
  id: "gen-r1",
  started: "",
  finished: "",
  model: "test",
  proposer: "live",
  backend: "hono-trpc-vite",
  full: true,
  cases: [
    caseResult("a-drafts", {
      not_delivered: ["Drafts visible only to their author: a read rule cannot depend on the published value"]
    }),
    caseResult("b-private-notes", {
      tags: ["gap"],
      not_delivered: [
        "Notes marked private should be hidden from other members; rules cannot look at a field's value",
        "Live updates when a note changes (realtime) are not expressible"
      ],
      failures: ["field Note.pinned missing"]
    }),
    caseResult("c-chat", {
      not_delivered: ["Real-time message delivery over websockets"],
      attempt_log: [{ attempt: 1, yaml: "", problems: ["M010 relation target Room does not exist"] }],
      attempts: 2
    }),
    caseResult("d-stats", {
      adds_actions: true,
      pass: false,
      not_delivered: ["Private posts should only be visible to their owner"],
      failures: ["full run on hono-trpc-vite failed at tests: 3 failed"],
      implement: {
        handlers: [{ handler: "posts_stats", ok: false, attempts: 3 }],
        usage,
        cost_usd: 0.2
      }
    })
  ]
};

describe("gap report", () => {
  it("files not_delivered lines under topics and strips names from the rest", () => {
    expect(gapTopic("Drafts visible only to their author: rules cannot depend on a value")).toBe(
      "rules on a field's value"
    );
    expect(gapTopic("Live updates over websockets")).toBe("realtime and live updates");
    expect(gapTopic("Monthly digest sent every week")).toBe("scheduled and recurring work");
    expect(normalizeGapText("The TeamMember row needs `invited_by` set to 3 users")).toBe(
      "the entity row needs … set to n users"
    );
  });

  it("clusters across cases and ranks by how many cases hit each cluster", () => {
    const clusters = clusterGaps(collectGaps([run]));
    const [first, second] = clusters;
    expect(first.key).toBe("rules on a field's value");
    expect(first.cases).toEqual(["a-drafts", "b-private-notes", "d-stats"]);
    expect(first.known).toBe(true);
    expect(first.examples).toHaveLength(2);
    expect(second.key).toBe("realtime and live updates");
    expect(second.cases).toEqual(["b-private-notes", "c-chat"]);
    expect(clusters.map(c => c.kind)).toEqual(
      expect.arrayContaining(["not_delivered", "check", "validation", "run", "handler"])
    );
    expect(clusters.find(c => c.kind === "run")?.key).toBe("full run failed at tests");
    expect(clusters.find(c => c.kind === "handler")?.cases).toEqual(["d-stats"]);
    expect(clusters.find(c => c.kind === "validation")?.key).toBe("relation target Entity does not exist");
  });

  it("writes a ranked table with examples", () => {
    const { markdown } = gapReport([run]);
    expect(markdown).toContain("| 1 | rules on a field's value | not_delivered | 3 | 3 | yes |");
    expect(markdown).toContain("## 1. rules on a field's value");
    expect(markdown).toContain("> Drafts visible only to their author");
    expect(markdown).toContain("4 case results");
  });
});
