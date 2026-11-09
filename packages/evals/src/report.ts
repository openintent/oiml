/** summary.md for a run: the headline rates, slices by tag, a digest of validation problems, and every case. */
import type { CaseResult, RunResult } from "./runner.js";

const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((n / d) * 100)}%`);
const money = (n: number | null) => (n == null ? "-" : `$${n.toFixed(3)}`);

export interface Rates {
  cases: number;
  errors: number;
  graded: number;
  valid: number;
  declined: number;
  first_attempt: number;
  checks_pass: number;
  pass: number;
  generate_pass: number;
  full_ran: number;
  full_pass: number;
  full_ran_no_actions: number;
  full_pass_no_actions: number;
  /** Full runs of diffs with actions whose handlers the model wrote */
  full_ran_implemented: number;
  full_pass_implemented: number;
  handlers_written: number;
  handlers_ok: number;
  handlers_first_attempt: number;
  implement_cost: number;
  attempts_mean: number;
  ms_mean: number;
  cost_total: number;
  tokens_in: number;
  tokens_out: number;
}

export function rates(cases: CaseResult[]): Rates {
  const graded = cases.filter(c => c.status !== "error");
  const valid = graded.filter(c => c.status === "ok");
  const declined = graded.filter(c => c.status === "declined");
  const full = valid.filter(c => c.full && !c.full.skipped);
  const fullNoActions = full.filter(c => !c.adds_actions);
  const implemented = full.filter(c => c.implement?.handlers.some(h => !h.skipped));
  const handlers = valid.flatMap(c => c.implement?.handlers.filter(h => !h.skipped) ?? []);
  return {
    cases: cases.length,
    errors: cases.length - graded.length,
    graded: graded.length,
    valid: valid.length,
    declined: declined.length,
    first_attempt: valid.filter(c => c.attempts === 1).length,
    checks_pass: valid.filter(c => !c.failures.some(f => !f.startsWith("full run") && !f.startsWith("generate on")))
      .length,
    pass: graded.filter(c => c.pass).length,
    generate_pass: valid.filter(c => Object.values(c.generate).every(g => g.ok)).length,
    full_ran: full.length,
    full_pass: full.filter(c => c.full!.ok).length,
    full_ran_no_actions: fullNoActions.length,
    full_pass_no_actions: fullNoActions.filter(c => c.full!.ok).length,
    full_ran_implemented: implemented.length,
    full_pass_implemented: implemented.filter(c => c.full!.ok).length,
    handlers_written: handlers.length,
    handlers_ok: handlers.filter(h => h.ok).length,
    handlers_first_attempt: handlers.filter(h => h.ok && h.attempts === 1).length,
    implement_cost: valid.reduce((n, c) => n + (c.implement?.cost_usd ?? 0), 0),
    attempts_mean: graded.length ? graded.reduce((n, c) => n + c.attempts, 0) / graded.length : 0,
    ms_mean: graded.length ? graded.reduce((n, c) => n + c.ms, 0) / graded.length : 0,
    cost_total: graded.reduce((n, c) => n + (c.cost_usd ?? 0), 0),
    tokens_in: graded.reduce(
      (n, c) => n + c.usage.input_tokens + c.usage.cache_read_input_tokens + c.usage.cache_creation_input_tokens,
      0
    ),
    tokens_out: graded.reduce((n, c) => n + c.usage.output_tokens, 0)
  };
}

/** Validation problems grouped by their shape, so a recurring one points at a reference-text gap */
export function problemDigest(cases: CaseResult[]): { key: string; count: number; cases: string[]; example: string }[] {
  const groups = new Map<string, { count: number; cases: Set<string>; example: string }>();
  for (const c of cases) {
    for (const attempt of c.attempt_log) {
      for (const problem of attempt.problems) {
        const key = normalizeProblem(problem);
        const group = groups.get(key) ?? { count: 0, cases: new Set(), example: problem };
        group.count++;
        group.cases.add(c.id);
        groups.set(key, group);
      }
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, count: g.count, cases: [...g.cases].sort(), example: g.example }))
    .sort((a, b) => b.count - a.count);
}

/** Strip the identifiers out of a problem so the same kind of mistake groups together */
export function normalizeProblem(problem: string): string {
  return problem
    .replace(/^[A-Za-z]\d{3}\s+/, "")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\b[A-Z][A-Za-z0-9]*\b/g, "Entity")
    .replace(/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*\b/g, "a.b")
    .replace(/\b\d+\b/g, "N")
    .trim();
}

export function summaryMarkdown(run: RunResult): string {
  const r = rates(run.cases);
  const lines: string[] = [];
  lines.push(`# Propose eval ${run.id}`, "");
  lines.push(
    `Model ${run.model}, proposer ${run.proposer}, ${r.cases} cases` +
      (run.full
        ? `, full runs on ${run.backend}${run.implement ? " with handlers written by the model" : ""}`
        : ", no full runs") +
      `. Started ${run.started}, finished ${run.finished}.`,
    ""
  );
  lines.push("## Headline", "");
  lines.push("| Metric | Value |", "| --- | --- |");
  lines.push(`| Pass (outcome as expected and every check) | ${r.pass}/${r.graded} (${pct(r.pass, r.graded)}) |`);
  lines.push(
    `| Valid diff within ${run.proposer === "live" ? "the attempts" : "one attempt"} | ${r.valid}/${r.graded} (${pct(r.valid, r.graded)}) |`
  );
  lines.push(`| Valid on the first attempt | ${r.first_attempt}/${r.graded} (${pct(r.first_attempt, r.graded)}) |`);
  lines.push(
    `| Expectation checks pass (valid diffs) | ${r.checks_pass}/${r.valid} (${pct(r.checks_pass, r.valid)}) |`
  );
  lines.push(
    `| Generates on every backend (valid diffs) | ${r.generate_pass}/${r.valid} (${pct(r.generate_pass, r.valid)}) |`
  );
  if (run.full) {
    lines.push(`| Full run passes (${run.backend}) | ${r.full_pass}/${r.full_ran} (${pct(r.full_pass, r.full_ran)}) |`);
    lines.push(
      `| Full run passes, diffs without actions${run.implement ? "" : " (handlers are stubs)"} | ${r.full_pass_no_actions}/${r.full_ran_no_actions} (${pct(r.full_pass_no_actions, r.full_ran_no_actions)}) |`
    );
    if (run.implement) {
      lines.push(
        `| Full run passes, diffs with actions (handlers written by the model) | ${r.full_pass_implemented}/${r.full_ran_implemented} (${pct(r.full_pass_implemented, r.full_ran_implemented)}) |`
      );
      lines.push(
        `| Handlers written / passing the check / on the first attempt | ${r.handlers_written} / ${r.handlers_ok} / ${r.handlers_first_attempt} |`
      );
      lines.push(`| Handler cost | ${money(r.implement_cost)} |`);
    }
  }
  lines.push(`| Declined (nothing expressible, with reasons) | ${r.declined} |`);
  lines.push(`| Proposer errors (not graded) | ${r.errors} |`);
  lines.push(`| Mean attempts | ${r.attempts_mean.toFixed(2)} |`);
  lines.push(`| Mean proposal latency | ${(r.ms_mean / 1000).toFixed(1)}s |`);
  lines.push(`| Tokens in / out | ${r.tokens_in.toLocaleString()} / ${r.tokens_out.toLocaleString()} |`);
  lines.push(`| Cost | ${money(r.cost_total)} |`);
  lines.push("");

  const tags = [...new Set(run.cases.flatMap(c => c.tags))].sort();
  if (tags.length) {
    lines.push("## By tag", "", "| Tag | Cases | Pass | Valid | First attempt |", "| --- | --- | --- | --- | --- |");
    for (const tag of tags) {
      const slice = rates(run.cases.filter(c => c.tags.includes(tag)));
      lines.push(
        `| ${tag} | ${slice.graded} | ${pct(slice.pass, slice.graded)} | ${pct(slice.valid, slice.graded)} | ${pct(slice.first_attempt, slice.graded)} |`
      );
    }
    lines.push("");
  }

  const digest = problemDigest(run.cases);
  if (digest.length) {
    lines.push("## Validation problems the agent hit", "", "| Count | Cases | Example |", "| --- | --- | --- |");
    for (const d of digest.slice(0, 25))
      lines.push(`| ${d.count} | ${d.cases.join(", ")} | ${escapeCell(d.example)} |`);
    lines.push("");
  }

  lines.push(
    "## Cases",
    "",
    "| Case | Result | Status | Attempts | Ops | Checks | Generate | Full | Latency | Cost |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const c of run.cases) {
    const checks =
      c.status === "ok" ? c.failures.filter(f => !f.startsWith("full run") && !f.startsWith("generate on")) : [];
    const generate = Object.values(c.generate);
    lines.push(
      `| ${c.id} | ${c.pass ? "pass" : "FAIL"} | ${c.status} | ${c.attempts} | ${c.ops} | ${
        c.status === "ok" ? (checks.length ? `${checks.length} failed` : "ok") : "-"
      } | ${generate.length ? `${generate.filter(g => g.ok).length}/${generate.length}` : "-"} | ${
        c.full ? (c.full.skipped ? "skipped" : c.full.ok ? "ok" : `FAIL ${c.full.failed_step}`) : "-"
      } | ${(c.ms / 1000).toFixed(0)}s | ${money(c.cost_usd)} |`
    );
  }
  lines.push("");

  const failing = run.cases.filter(c => !c.pass);
  if (failing.length) {
    lines.push("## Failures", "");
    for (const c of failing) {
      lines.push(`### ${c.id}`, "");
      if (c.error) lines.push("```", c.error.split("\n").slice(0, 12).join("\n"), "```", "");
      for (const f of c.failures) lines.push(`- ${f}`);
      if (c.metrics) lines.push("", `Scenarios: ${describeMetrics(c)}`);
      if (c.not_delivered.length) lines.push("", `Not delivered: ${c.not_delivered.join("; ")}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function describeMetrics(c: CaseResult): string {
  const m = c.metrics!;
  return `${m.scenarios} added, ${m.steps} steps, ${m.rejections} rejections (statuses ${m.statuses.join("/") || "-"}), new resources/actions touched ${m.touched.length}/${m.added.length}`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
}

/** Per-case differences between two runs, for before/after a reference or prompt change */
export function compareRuns(before: RunResult, after: RunResult): string {
  const lines: string[] = [`# ${before.id} -> ${after.id}`, ""];
  const b = rates(before.cases);
  const a = rates(after.cases);
  lines.push("| Metric | Before | After |", "| --- | --- | --- |");
  lines.push(`| Pass | ${b.pass}/${b.graded} | ${a.pass}/${a.graded} |`);
  lines.push(`| Valid | ${b.valid}/${b.graded} | ${a.valid}/${a.graded} |`);
  lines.push(`| First attempt | ${b.first_attempt}/${b.graded} | ${a.first_attempt}/${a.graded} |`);
  lines.push(`| Full pass | ${b.full_pass}/${b.full_ran} | ${a.full_pass}/${a.full_ran} |`);
  lines.push(`| Cost | ${money(b.cost_total)} | ${money(a.cost_total)} |`, "");
  const beforeById = new Map(before.cases.map(c => [c.id, c]));
  const changed: string[] = [];
  for (const c of after.cases) {
    const prev = beforeById.get(c.id);
    if (!prev) {
      changed.push(`- ${c.id}: new (${c.pass ? "pass" : "FAIL"})`);
      continue;
    }
    if (prev.pass !== c.pass) changed.push(`- ${c.id}: ${prev.pass ? "pass" : "FAIL"} -> ${c.pass ? "pass" : "FAIL"}`);
    else if (prev.attempts !== c.attempts) changed.push(`- ${c.id}: attempts ${prev.attempts} -> ${c.attempts}`);
  }
  for (const id of beforeById.keys()) if (!after.cases.some(c => c.id === id)) changed.push(`- ${id}: dropped`);
  lines.push(changed.length ? "## Changed cases" : "No case changed.", "", ...changed, "");
  return lines.join("\n");
}
