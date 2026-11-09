/**
 * The gap report: what agents could not express, got wrong or failed to run across one or more runs,
 * clustered by topic and ranked by how many cases hit each cluster. A cluster that recurs is the next
 * construct, or the next sentence in the reference; the report names which, by kind.
 */
import type { CaseResult, RunResult } from "./runner.js";
import { normalizeProblem } from "./report.js";

export type GapKind = "not_delivered" | "check" | "run" | "handler" | "validation";

export interface GapItem {
  kind: GapKind;
  text: string;
  run: string;
  caseId: string;
  /** The case's tags, so a cluster can say whether the corpus already names it as a gap */
  tags: string[];
}

export interface GapCluster {
  /** Topic name or the normalized text when no topic matches */
  key: string;
  kind: GapKind;
  /** Distinct cases that hit it */
  cases: string[];
  count: number;
  /** Verbatim lines, two at most, from different cases where possible */
  examples: string[];
  /** The corpus already has a case tagged gap or trap in this cluster */
  known: boolean;
}

/** Topics a not_delivered line can belong to, matched on keywords; the first match wins */
const TOPICS: [topic: string, pattern: RegExp][] = [
  [
    "rules on a field's value",
    /\b(value|values|depend|depending|conditional|only when|status is|draft|own (unpublished|private)|visib)/i
  ],
  ["realtime and live updates", /\b(real[- ]?time|websocket|live update|subscri|push notif|presence|stream)/i],
  [
    "payments and billing",
    /\b(payment|billing|stripe|invoice|subscription plan|checkout|price|paid|credit card|charge)/i
  ],
  [
    "scheduled and recurring work",
    /\b(schedul|cron|recurr|remind|every (day|week|month|hour)|digest at|deadline passes|expire|time[- ]based)/i
  ],
  ["search and ranking", /\b(full[- ]text|fuzzy|search rank|relevan|autocomplete|typeahead|facet)/i],
  ["email and notifications", /\b(notif|e-?mail(s|ing)? (is|are|gets)? ?sent|send (an? )?e-?mail|sms|in-app message)/i],
  [
    "computed and aggregate fields",
    /\b(count of|number of|total|sum|average|aggregate|derived|computed|denormali|increment|counter)/i
  ],
  [
    "uniqueness and constraints",
    /\b(unique per|composite unique|constraint|at most one|only one|exclusive|check constraint)/i
  ],
  ["ordering and positions", /\b(reorder|drag.{0,20}order|position|rank order|sort order|manual order)/i],
  ["history, versions and audit", /\b(histor|version|audit|revision|undo|log of changes|changelog|track changes)/i],
  ["invites and onboarding", /\b(invit|onboard|join link|accept(ing)? (an? )?invitation|pending member)/i],
  ["files and media", /\b(thumbnail|resize|image process|video|transcod|multiple files|gallery|attachment limit)/i],
  [
    "pages beyond master-detail",
    /\b(page|dashboard|chart|graph|calendar view|timeline|kanban|wizard|form layout|custom ui|report view)/i
  ],
  [
    "external integrations",
    /\b(webhook|third[- ]party|external api|integrat|oauth scope|import from|sync with|slack|github api)/i
  ],
  ["import and export", /\b(export|import|csv|xlsx|download (a|the) (list|report)|bulk upload)/i],
  ["bulk and batch operations", /\b(bulk|batch|multiple rows|select all|mass)/i],
  ["soft delete and archiving", /\b(soft[- ]delete|trash|restore|archiv|retention)/i],
  ["rate limits and quotas", /\b(rate[- ]limit|quota|throttl|per day limit|max(imum)? per)/i],
  ["localisation", /\b(locali[sz]|translat|i18n|multi-?language|time ?zone)/i],
  [
    "identity and access beyond roles",
    /\b(two[- ]factor|2fa|mfa|password reset|api key|token|sso|saml|impersonat|permission matrix|per-field access|field-level)/i
  ],
  [
    "default values from context",
    /\b(default(s|ed)? (to|from) the (current|signed|session)|prefill|auto-?assign|automatically set)/i
  ],
  [
    "relations beyond many-to-one",
    /\b(many[- ]to[- ]many|self[- ]referen|polymorphic|tree|hierarch|nested|parent.{0,20}child|ancestor)/i
  ]
];

/** The topic a not_delivered line belongs to, or its normalized text when none matches */
export function gapTopic(text: string): string {
  for (const [topic, pattern] of TOPICS) if (pattern.test(text)) return topic;
  return normalizeGapText(text);
}

/** Strip names and numbers from prose so two sentences about the same thing compare equal more often */
export function normalizeGapText(text: string): string {
  return text
    .replace(/`[^`]*`/g, "…")
    .replace(/"[^"]*"/g, "…")
    .replace(/\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b/g, "Entity")
    .replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, "field")
    .replace(/\b\d+\b/g, "N")
    .toLowerCase()
    .replace(/[^a-z…\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 14)
    .join(" ");
}

/** The shape of an expectation failure or a full-run failure: the construct named, without the identifiers */
function failureShape(text: string): string {
  const run = text.match(/^full run on [\w-]+ failed at (\w+)/);
  if (run) return `full run failed at ${run[1]}`;
  if (text.startsWith("full run crashed")) return "full run crashed";
  const generate = text.match(/^generate on [\w-]+/);
  if (generate) return "generate failed";
  return normalizeProblem(text);
}

/** Every gap-shaped fact the runs recorded, one item per line */
export function collectGaps(runs: RunResult[]): GapItem[] {
  const items: GapItem[] = [];
  for (const run of runs) {
    for (const c of run.cases) {
      const base = { run: run.id, caseId: c.id, tags: c.tags };
      for (const line of c.not_delivered) items.push({ ...base, kind: "not_delivered", text: line });
      for (const f of c.failures) {
        if (f.startsWith("invalid: ") || f.startsWith("declined: ")) continue;
        items.push({ ...base, kind: f.startsWith("full run") ? "run" : "check", text: f });
      }
      for (const attempt of c.attempt_log ?? [])
        for (const problem of attempt.problems) items.push({ ...base, kind: "validation", text: problem });
      for (const h of c.implement?.handlers ?? [])
        if (!h.skipped && !h.ok)
          items.push({
            ...base,
            kind: "handler",
            text: `handler ${h.handler} still failed the check after ${h.attempts} attempts`
          });
    }
  }
  return items;
}

/** Cluster the items by kind and key, ranked by distinct cases hit, then by total count */
export function clusterGaps(items: GapItem[]): GapCluster[] {
  const groups = new Map<
    string,
    { kind: GapKind; key: string; cases: Set<string>; count: number; examples: Map<string, string>; known: boolean }
  >();
  for (const item of items) {
    const key =
      item.kind === "not_delivered"
        ? gapTopic(item.text)
        : item.kind === "validation"
          ? normalizeProblem(item.text)
          : item.kind === "handler"
            ? "handler failed the check"
            : failureShape(item.text);
    const id = `${item.kind}\u0000${key}`;
    const group = groups.get(id) ?? {
      kind: item.kind,
      key,
      cases: new Set(),
      count: 0,
      examples: new Map(),
      known: false
    };
    group.cases.add(item.caseId);
    group.count++;
    if (!group.examples.has(item.caseId) && group.examples.size < 2) group.examples.set(item.caseId, item.text);
    if (item.tags.includes("gap") || item.tags.includes("trap")) group.known = true;
    groups.set(id, group);
  }
  return [...groups.values()]
    .map(g => ({
      key: g.key,
      kind: g.kind,
      cases: [...g.cases].sort(),
      count: g.count,
      examples: [...g.examples.values()],
      known: g.known
    }))
    .sort((a, b) => b.cases.length - a.cases.length || b.count - a.count || a.key.localeCompare(b.key));
}

const KIND_LABEL: Record<GapKind, string> = {
  not_delivered: "the agent said the model cannot express it",
  check: "an expectation check failed",
  run: "the full run failed",
  handler: "a written handler failed the check",
  validation: "a diff attempt was invalid"
};

/** What each kind of cluster usually asks for */
const KIND_ACTION: Record<GapKind, string> = {
  not_delivered:
    "a construct, if it has a deterministic mapping on every backend; otherwise a reference sentence saying so",
  check: "a reference sentence, or a case whose expectation was wrong",
  run: "a compiler or harness fix, or a scenario the agent wrote wrong",
  handler: "a handler guide sentence or a generated helper",
  validation: "a reference sentence where the agent guessed"
};

export function gapsMarkdown(runs: RunResult[], clusters: GapCluster[]): string {
  const lines: string[] = [];
  const cases = runs.reduce((n, r) => n + r.cases.length, 0);
  lines.push("# Gap report", "");
  lines.push(
    `From ${runs.length} run${runs.length === 1 ? "" : "s"} (${runs.map(r => r.id).join(", ")}), ${cases} case results. ` +
      "Clusters are ranked by how many cases hit them; a known cluster already has a case tagged gap or trap in the corpus.",
    ""
  );
  if (clusters.length === 0) {
    lines.push("Nothing to report: no not_delivered lines, failures or invalid attempts.", "");
    return lines.join("\n");
  }
  lines.push("| # | Cluster | Kind | Cases | Hits | Known |", "| --- | --- | --- | --- | --- | --- |");
  clusters.forEach((c, i) =>
    lines.push(`| ${i + 1} | ${c.key} | ${c.kind} | ${c.cases.length} | ${c.count} | ${c.known ? "yes" : ""} |`)
  );
  lines.push("");
  for (const [i, c] of clusters.entries()) {
    lines.push(`## ${i + 1}. ${c.key}`, "");
    lines.push(
      `${KIND_LABEL[c.kind]}; ${c.cases.length} case${c.cases.length === 1 ? "" : "s"}: ${c.cases.join(", ")}.`
    );
    lines.push(`Usually asks for ${KIND_ACTION[c.kind]}.`, "");
    for (const e of c.examples) lines.push(`> ${e.replace(/\n/g, " ")}`, ">");
    lines.pop();
    lines.push("");
  }
  return lines.join("\n");
}

/** Convenience for the CLI and tests: the report of several runs' results */
export function gapReport(runs: RunResult[]): { clusters: GapCluster[]; markdown: string } {
  const clusters = clusterGaps(collectGaps(runs));
  return { clusters, markdown: gapsMarkdown(runs, clusters) };
}

export type { CaseResult };
