import { describe, expect, it } from "vitest";
import {
  clusterGaps,
  collectGaps,
  compareGaps,
  compareMarkdown,
  gapReport,
  gapTopic,
  normalizeGapText
} from "../src/gaps.js";
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

  it("files server-owned fields and conjunctions under their own topics", () => {
    expect(gapTopic("The banned flag must be read-only for clients")).toBe("server-owned fields");
    expect(
      gapTopic("A create rule cannot require membership and bind the author at the same time as checking the team")
    ).toBe("rule conjunctions");
    expect(gapTopic("Deletion by the owner or an admin needs an alternative rule")).toBe("rule alternatives and paths");
    expect(gapTopic("The rules can't require both team membership and a writer taken from the session")).toBe(
      "rule conjunctions"
    );
    expect(gapTopic("The rule cannot stop an owner from changing their own membership's role")).toBe("role changes");
    expect(gapTopic("A signed-out visitor opening the roadmap of a project that is not public")).toBe(
      "rules on a field's value"
    );
    expect(gapTopic("No construct lets office staff promote a user to the office role")).toBe("role changes");
    expect(gapTopic("Invitations are direct adds by an owner or editor; there is no invite-and-accept flow")).toBe(
      "invites and onboarding"
    );
    expect(gapTopic("The model cannot require go_live_at only for cards whose status is scheduled")).toBe(
      "conditional validation"
    );
    expect(gapTopic("The PRJ-0042 format: the model has no sequence or format construct")).toBe(
      "sequences and reference numbers"
    );
    expect(
      gapTopic("A separate public URL for each organisation's roadmap: pages cannot take the organisation from the URL")
    ).toBe("pages with parameters");
    expect(
      gapTopic("Sending a new Google user to the teams page after sign-in: no setting for where a sign-in lands")
    ).toBe("sign-in flow settings");
    expect(gapTopic("A task's read rule can only check the task's own fields, not whether its project is public")).toBe(
      "conditions through relations"
    );
    expect(
      gapTopic("The article appearing in the public list at its scheduled time depends on that automatic publishing")
    ).toBe("scheduled and recurring work");
  });

  it("compares two reports: new, grown, shrunk and gone clusters", () => {
    const previous = clusterGaps(collectGaps([run]));
    const next = clusterGaps(
      collectGaps([
        {
          ...run,
          id: "gen-r2",
          cases: [
            caseResult("e-feed", { not_delivered: ["A live feed of new posts over websockets"] }),
            caseResult("f-drafts", { not_delivered: ["Drafts visible only to their author"] }),
            caseResult("g-invoices", { not_delivered: ["Invite teammates by email before they have an account"] })
          ]
        }
      ])
    );
    const changes = compareGaps(previous, next);
    expect(changes[0]).toMatchObject({ key: "invites and onboarding", change: "new", before: 0, after: 1 });
    expect(changes.find(c => c.key === "rules on a field's value")).toMatchObject({
      change: "shrunk",
      before: 3,
      after: 1
    });
    expect(changes.find(c => c.key === "realtime and live updates")).toMatchObject({
      change: "shrunk",
      before: 2,
      after: 1
    });
    expect(
      changes
        .filter(c => c.change === "gone")
        .map(c => c.kind)
        .sort()
    ).toEqual(["check", "handler", "run", "validation"]);
    const md = compareMarkdown("gen-r1", "gen-r2", changes);
    expect(md).toContain("| new | invites and onboarding | not_delivered | 0 | 1 |");
    expect(md).toContain("1 new, 0 grown, 2 shrunk, 4 gone, 0 unchanged");
  });

  it("writes a ranked table with examples", () => {
    const { markdown } = gapReport([run]);
    expect(markdown).toContain("| 1 | rules on a field's value | not_delivered | 3 | 3 | known |");
    expect(markdown).toContain("## 1. rules on a field's value");
    expect(markdown).toContain("> Drafts visible only to their author");
    expect(markdown).toContain("4 case results");
  });
});
