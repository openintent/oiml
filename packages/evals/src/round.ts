/**
 * One round of the loop: generate intents, run them (full runs with handlers written by default), write the gap
 * report, fold it into the backlog, and compare with the previous round. Everything lands in one folder under
 * evals/propose/generated/<round>: cases, run, gaps.md, compare-gaps.md and round.yaml.
 */
import { existsSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fromYaml, toYaml } from "@osl/core";
import {
  BACKLOG_FILE,
  entryFor,
  loadBacklog,
  saveBacklog,
  statusText,
  updateBacklog,
  type BacklogEntry
} from "./backlog.js";
import { loadCases } from "./cases.js";
import {
  clusterGaps,
  collectGaps,
  compareGaps,
  compareMarkdown,
  gapsMarkdown,
  type GapChange,
  type GapCluster
} from "./gaps.js";
import { generateRound } from "./generate.js";
import { costUsd } from "./pricing.js";
import { rates, summaryMarkdown } from "./report.js";
import { runAll, type RunResult } from "./runner.js";

export const ROUNDS_DIR = "evals/propose/generated";

export interface RoundOptions {
  repoRoot: string;
  round: string;
  count: number;
  seed: number;
  model: string;
  /** Run the generated apps and their scenarios (default true) */
  full: boolean;
  /** Write the action handlers with the model before the full runs (default true) */
  implement: boolean;
  backend: string;
  databaseUrl?: string;
  /** The round to compare with; default: the most recent other round that has a run */
  previous?: string;
  maxCostUsd?: number;
  jobs: number;
  fullJobs: number;
  log: (line: string) => void;
}

export interface RoundSummary {
  round: string;
  dir: string;
  cases: number;
  pass: number;
  valid: number;
  declined: number;
  errors: number;
  /** Proposals plus handlers */
  run_cost_usd: number;
  generation_cost_usd: number | null;
  /** The clusters, ranked */
  clusters: GapCluster[];
  /** Against the previous round, when there was one */
  previous?: string;
  changes?: GapChange[];
  added: BacklogEntry[];
  regressions: BacklogEntry[];
  ms: number;
}

/** The round folder with the most recent run, other than `current`: by the time its results were last written */
export async function previousRound(repoRoot: string, current: string): Promise<string | undefined> {
  const root = path.join(repoRoot, ROUNDS_DIR);
  if (!existsSync(root)) return undefined;
  const candidates: { name: string; mtime: number }[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === current) continue;
    const results = path.join(root, entry.name, "run", "results.json");
    if (!existsSync(results)) continue;
    candidates.push({ name: entry.name, mtime: (await stat(results)).mtimeMs });
  }
  return candidates.sort((a, b) => b.mtime - a.mtime)[0]?.name;
}

export async function readRun(dir: string): Promise<RunResult> {
  return JSON.parse(await readFile(path.join(dir, "results.json"), "utf8")) as RunResult;
}

export async function runRound(options: RoundOptions): Promise<RoundSummary> {
  const started = Date.now();
  const dir = path.join(options.repoRoot, ROUNDS_DIR, options.round);
  const casesDir = path.join(dir, "cases");
  let generationCost: number | null = null;
  if (existsSync(casesDir) && (await readdir(casesDir)).some(f => f.endsWith(".yaml"))) {
    options.log(`round ${options.round}: reusing the cases already in ${path.relative(options.repoRoot, casesDir)}`);
  } else {
    options.log(`round ${options.round}: ${options.count} intents from seed ${options.seed} with ${options.model}`);
    const generated = await generateRound({
      repoRoot: options.repoRoot,
      round: options.round,
      count: options.count,
      seed: options.seed,
      outDir: dir,
      model: options.model
    });
    generationCost = costUsd(options.model, generated.usage);
    for (const id of generated.ids) options.log(`  ${id}`);
  }
  const cases = await loadCases(casesDir);

  const runDir = path.join(dir, "run");
  const run = await runAll(cases, {
    repoRoot: options.repoRoot,
    outDir: runDir,
    proposer: "live",
    model: options.model,
    jobs: options.jobs,
    fullJobs: options.fullJobs,
    full: options.full,
    implement: options.implement,
    backend: options.backend,
    databaseUrl: options.databaseUrl,
    maxCostUsd: options.maxCostUsd,
    log: options.log
  });
  await writeFile(path.join(runDir, "summary.md"), summaryMarkdown(run));

  const backlogFile = path.join(options.repoRoot, BACKLOG_FILE);
  const clusters = clusterGaps(collectGaps([run]));
  const update = updateBacklog(await loadBacklog(backlogFile), clusters, options.round);
  await saveBacklog(backlogFile, update.backlog);
  const status = (c: GapCluster) => {
    const entry = entryFor(update.backlog, c);
    return entry ? statusText(entry) : undefined;
  };
  await writeFile(path.join(dir, "gaps.md"), gapsMarkdown([run], clusters, status));

  const previous = options.previous ?? (await previousRound(options.repoRoot, options.round));
  let changes: GapChange[] | undefined;
  if (previous) {
    const previousRun = await readRun(path.join(options.repoRoot, ROUNDS_DIR, previous, "run"));
    changes = compareGaps(clusterGaps(collectGaps([previousRun])), clusters);
    await writeFile(path.join(dir, "compare-gaps.md"), compareMarkdown(previous, options.round, changes));
  }

  const r = rates(run.cases);
  const summary: RoundSummary = {
    round: options.round,
    dir,
    cases: run.cases.length,
    pass: r.pass,
    valid: r.valid,
    declined: r.declined,
    errors: r.errors,
    run_cost_usd: r.cost_total + r.implement_cost,
    generation_cost_usd: generationCost,
    clusters,
    previous,
    changes,
    added: update.added,
    regressions: update.regressions,
    ms: Date.now() - started
  };
  const roundFile = path.join(dir, "round.yaml");
  const existing = existsSync(roundFile)
    ? (fromYaml<Record<string, unknown>>(await readFile(roundFile, "utf8")) ?? {})
    : {};
  await writeFile(
    path.join(dir, "round.yaml"),
    toYaml({
      ...existing,
      finished: new Date().toISOString(),
      backend: options.backend,
      full: options.full,
      implement: options.implement,
      cases: summary.cases,
      pass: summary.pass,
      valid: summary.valid,
      declined: summary.declined,
      errors: summary.errors,
      run_cost_usd: Number(summary.run_cost_usd.toFixed(3)),
      generation_cost_usd: generationCost === null ? null : Number(generationCost.toFixed(3)),
      previous: previous ?? null,
      top_gaps: clusters.slice(0, 5).map(c => ({ key: c.key, kind: c.kind, cases: c.cases.length })),
      regressions: update.regressions.map(e => e.key),
      minutes: Number((summary.ms / 60000).toFixed(1))
    })
  );
  return summary;
}

/** The round's result in a few lines, for the terminal and the job summary */
export function roundText(s: RoundSummary): string {
  const lines = [
    `Round ${s.round}: ${s.pass}/${s.cases} pass, ${s.valid} valid, ${s.declined} declined, ${s.errors} not graded; ` +
      `$${s.run_cost_usd.toFixed(2)} run${s.generation_cost_usd !== null ? ` + $${s.generation_cost_usd.toFixed(2)} generation` : ""}, ${(s.ms / 60000).toFixed(1)} min.`,
    ""
  ];
  if (s.clusters.length) {
    lines.push("Top gaps:");
    for (const c of s.clusters.slice(0, 5))
      lines.push(`  ${c.cases.length} case${c.cases.length === 1 ? "" : "s"}  ${c.key} (${c.kind})`);
  } else lines.push("No gaps reported.");
  if (s.changes) {
    const moved = s.changes.filter(c => c.change !== "same");
    lines.push(
      "",
      `Against ${s.previous}: ${moved.length ? moved.map(c => `${c.change} ${c.key} (${c.before} to ${c.after})`).join("; ") : "no change"}`
    );
  }
  if (s.added.length) lines.push("", `New in the backlog: ${s.added.map(e => e.key).join("; ")}`);
  if (s.regressions.length)
    lines.push("", `REGRESSIONS: ${s.regressions.map(e => `${e.key} (built: ${e.construct ?? "?"})`).join("; ")}`);
  return lines.join("\n");
}
