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
      gapTopic("One dashboard per team: a page cannot be scoped to a single team, so the counts span every team")
    ).toBe("pages with parameters");
    expect(gapTopic("The counts are not pushed live. The overview page refetches every 15 seconds instead.")).toBe(
      "realtime and live updates"
    );
    expect(
      gapTopic("A visitor who opens a draft gets 401 or 403, not 404: a hidden row answers with a refusal, never 404")
    ).toBe("hidden rows as not found");
    expect(
      gapTopic(
        "The 24-hour RSVP cutoff is enforced by a schedule every 5 minutes, because a timer cannot fire before a date"
      )
    ).toBe("timers before a date");
    expect(
      gapTopic(
        "Allowing task create only when the request carries the project's correct edit code is not expressible: rules never check a secret sent with the request"
      )
    ).toBe("shared secrets and access codes");
    expect(gapTopic("A write-only edit code on a project is not expressible: a hidden field is never accepted")).toBe(
      "shared secrets and access codes"
    );
    expect(
      gapTopic(
        "A timer cannot run off due_on because it is a date, not a datetime, and nothing compares a field against now"
      )
    ).toBe("timers on date fields");
    expect(gapTopic("error timers[0].at: field due_on must be a datetime, not date")).toBe("timers on date fields");
    expect(
      gapTopic(
        "The homepage cannot show the featured article as a wide banner. Dashboard pages only have count tiles and recent-row lists."
      )
    ).toBe("dashboard panels beyond counts");
    expect(gapTopic("dashboard tiles only count rows and there is no sum or aggregate construct")).toBe(
      "computed and aggregate fields"
    );
    expect(
      gapTopic(
        "Clearing overdue: the flag is set by a timer when due_at passes, but it is not cleared if the date moves"
      )
    ).toBe("computed and aggregate fields");
    expect(gapTopic("The enrolled count is a stored field kept up to date by the handler")).toBe(
      "computed and aggregate fields"
    );
    expect(gapTopic("The publish and unpublish handlers are stubs to fill in: publish sets status to published")).toBe(
      "handlers left to implement"
    );
    expect(
      gapTopic("The article appearing in the public list at its scheduled time depends on that automatic publishing")
    ).toBe("scheduled and recurring work");
  });

  it("files what a round says of detail pages under what it lacks, not under the pages that were built", () => {
    expect(
      gapTopic(
        "Images do not show inline on the thread page. Sections are plain lists and file fields cannot be list columns"
      )
    ).toBe("sections beyond lists");
    expect(
      gapTopic("The summary counts of open and done tasks: a detail page cannot show counts or tiles, only lists")
    ).toBe("sections beyond lists");
    expect(
      gapTopic(
        "A public page per user is not provided. Its page would be served by a users resource, and that resource would also return every user's email address"
      )
    ).toBe("field-level visibility");
    expect(
      gapTopic("Public instructor profiles also expose the instructor's email: read rules apply to whole rows")
    ).toBe("field-level visibility");
    expect(gapTopic("Overdue tasks: the model cannot compare due_on against today in a rule, a filter or a page")).toBe(
      "conditions against now"
    );
    expect(gapTopic("Showing only upcoming events (starting after now) has no construct")).toBe(
      "conditions against now"
    );
    expect(
      gapTopic(
        "The home page cannot list tasks from the projects I follow. Pages and list filters are equality-only on the task's own fields"
      )
    ).toBe("list filters through a relation");
    expect(
      gapTopic(
        "A single studio page listing every listing: the studio page lists its collections and each collection page lists its listings"
      )
    ).toBe("list filters through a relation");
    expect(
      gapTopic(
        "tasks.clear_done now runs only from its nightly schedule. As a system job it is not scoped to one team."
      )
    ).toBe("schedules per tenant");
    expect(
      gapTopic(
        "Limiting collection staff to people who are already staff of the studio: a rule cannot check the user being added"
      )
    ).toBe("write checks on related rows");
    expect(
      gapTopic("Moving a task to another project on update is not limited to projects the editor is a member of.")
    ).toBe("write checks on related rows");
    expect(gapTopic("Signing in with GitHub is configured, but no scenario step can drive an OAuth sign-in")).toBe(
      "provider sign-in in scenarios"
    );
    expect(gapTopic("The Google sign-in itself cannot be exercised by contract scenarios")).toBe(
      "provider sign-in in scenarios"
    );
    expect(
      gapTopic(
        "When a client sends edited_at with an update, it is refused with a 400. The criterion asked for the value to be silently ignored."
      )
    ).toBe("ignoring input to read-only fields");
    expect(
      gapTopic("The publish action's handler must set published_at to ctx.now. It is generated as a stub you fill in")
    ).toBe("handlers left to implement");
    expect(gapTopic("Paying the studio out once an order ships: the model cannot make payouts")).toBe(
      "payments and billing"
    );
  });

  it("files what a round says beside the invites it used under what it lacks, not under what was built", () => {
    expect(
      gapTopic(
        "The automatic friendly reminder email after three days for unaccepted invitations: the invite rows are generated by OSL and cannot carry a timer or action, so the only way to send it again is to revoke the invite and invite again."
      )
    ).toBe("invite reminders and resending");
    expect(gapTopic("Resending an invitation that was lost is not an operation")).toBe(
      "invite reminders and resending"
    );
    expect(
      gapTopic(
        "The admin invitation list cannot be limited to reviewer invitations. The invite list filters only by article, so it shows editor and reviewer invitations together, each with its role."
      )
    ).toBe("invite list filters");
    expect(gapTopic("Filtering the pending invitations by role is not possible")).toBe("invite list filters");
    expect(gapTopic("Invite teammates by email before they have an account")).toBe("invites and onboarding");
    expect(
      gapTopic(
        "A writer can still mark their own publication article published through a plain update, because the published field stays writable for everyone allowed to update. Which fields a client may write cannot depend on their role."
      )
    ).toBe("role changes");
    expect(
      gapTopic(
        "A writer can still set published or publish_at on their own draft through create or update, because what a client may write into a field cannot depend on their role."
      )
    ).toBe("role changes");
    expect(
      gapTopic(
        "Only the publish action, including the scheduled publish timer that runs it, stamps published_at. An article created or updated with published: true directly gets no published_at, so its comments never auto-lock."
      )
    ).toBe("state machines and transitions");
    expect(gapTopic("A reminder scheduled for the morning of the due date")).toBe("scheduled and recurring work");
    expect(
      gapTopic(
        "Requiring that the person a studio owner adds to a collection is already a member of that studio: the collaborator's user_id is checked to exist, but a rule cannot constrain the written value by membership of the studio."
      )
    ).toBe("write checks on related rows");
    expect(
      gapTopic(
        "Booking does not check that the chosen practitioner actually offers the chosen treatment; no rule can compare two relations of the same row."
      )
    ).toBe("write checks on related rows");
    expect(
      gapTopic(
        "Uploaded files are publicly readable by their URL, so a draft note's attachment is not protected by the note's draft rule, only by its unguessable id."
      )
    ).toBe("files and media");
    expect(gapTopic("Posts cannot carry a gallery of multiple files")).toBe("files and media");
    expect(
      gapTopic(
        "The article page lists its attached images in position order in a section; rendering the pictures themselves as an inline gallery under the text is not a page construct, since file fields cannot be section or list columns."
      )
    ).toBe("sections beyond lists");
    expect(
      gapTopic("The Google sign-in provider is declared, but no scenario step can simulate an OAuth round trip.")
    ).toBe("provider sign-in in scenarios");
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
