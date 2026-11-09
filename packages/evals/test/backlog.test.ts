import { describe, expect, it } from "vitest";
import { openGaps, statusText, updateBacklog, type Backlog } from "../src/backlog.js";
import type { GapCluster } from "../src/gaps.js";

const cluster = (key: string, cases: string[], kind: GapCluster["kind"] = "not_delivered"): GapCluster => ({
  key,
  kind,
  cases,
  count: cases.length,
  examples: [],
  known: false
});

const backlog: Backlog = {
  gaps: [
    {
      key: "rules on a field's value",
      kind: "not_delivered",
      status: "open",
      first_seen: "run6",
      last_seen: "run6",
      cases: 2
    },
    {
      key: "server-owned fields",
      kind: "not_delivered",
      status: "built",
      first_seen: "run4",
      last_seen: "run6",
      cases: 1,
      construct: "read_only",
      version: "unreleased"
    },
    {
      key: "payments and billing",
      kind: "not_delivered",
      status: "declined",
      first_seen: "run6",
      last_seen: "run6",
      cases: 2
    }
  ]
};

describe("gap backlog", () => {
  it("appends new clusters as open, refreshes known ones and never flips a status", () => {
    const update = updateBacklog(
      backlog,
      [
        cluster("rules on a field's value", ["a", "b", "c"]),
        cluster("scheduled and recurring work", ["d"]),
        cluster("gap free sequential numbering has no construct", ["f"]),
        cluster("full run failed at tests", ["e"], "run")
      ],
      "r1"
    );
    expect(update.added.map(e => e.key)).toEqual(["scheduled and recurring work"]);
    expect(update.regressions).toEqual([]);
    const rules = update.backlog.gaps.find(g => g.key === "rules on a field's value")!;
    expect(rules).toMatchObject({ status: "open", first_seen: "run6", last_seen: "r1", cases: 3 });
    const added = update.backlog.gaps.find(g => g.key === "scheduled and recurring work")!;
    expect(added).toMatchObject({ status: "open", first_seen: "r1", last_seen: "r1", cases: 1, kind: "not_delivered" });
    // failures are fixed, not tracked; a one-off wording waits for a second case
    expect(update.backlog.gaps.some(g => g.key === "full run failed at tests")).toBe(false);
    expect(update.backlog.gaps.some(g => g.key.startsWith("gap free"))).toBe(false);
    // the input is left alone
    expect(backlog.gaps[0].last_seen).toBe("run6");
  });

  it("reports a built gap that reappears as a regression", () => {
    const update = updateBacklog(backlog, [cluster("server-owned fields", ["x", "y"])], "r2");
    expect(update.regressions.map(e => e.key)).toEqual(["server-owned fields"]);
    expect(update.backlog.gaps.find(g => g.key === "server-owned fields")).toMatchObject({
      status: "built",
      last_seen: "r2",
      cases: 2
    });
  });

  it("labels entries and ranks the open ones by cases", () => {
    expect(statusText(backlog.gaps[0])).toBe("open since run6");
    expect(statusText(backlog.gaps[1])).toBe("built: read_only (unreleased)");
    expect(statusText(backlog.gaps[2])).toBe("declined");
    const more: Backlog = {
      gaps: [
        ...backlog.gaps,
        {
          key: "pages beyond master-detail",
          kind: "not_delivered",
          status: "open",
          first_seen: "r1",
          last_seen: "r1",
          cases: 5
        }
      ]
    };
    expect(openGaps(more).map(g => g.key)).toEqual(["pages beyond master-detail", "rules on a field's value"]);
  });
});
