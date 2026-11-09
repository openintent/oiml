#!/usr/bin/env node
/**
 * pnpm evals:gaps <run dir> [<run dir> ...] [--out file] [--backlog file | --no-backlog]
 *
 * Reads each run's results.json and writes gaps.md: what agents could not express, got wrong or failed to
 * run, clustered by topic and ranked by how many cases hit each cluster. Default output: gaps.md in the
 * first run directory. The backlog (evals/propose/gaps.yaml) is updated: new not_delivered clusters are
 * appended as open, counts refreshed, and a built gap that reappears is reported as a regression.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BACKLOG_FILE, entryFor, loadBacklog, saveBacklog, statusText, updateBacklog } from "./backlog.js";
import { clusterGaps, collectGaps, gapsMarkdown, type GapCluster } from "./gaps.js";
import type { RunResult } from "./runner.js";

const args = process.argv.slice(2);
const flagValue = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const out = flagValue("--out");
const noBacklog = args.includes("--no-backlog");
const repoRoot = path.resolve(process.env.OSL_REPO_ROOT ?? process.cwd());
const backlogFile = path.resolve(flagValue("--backlog") ?? path.join(repoRoot, BACKLOG_FILE));
const skip = new Set<number>();
for (const flag of ["--out", "--backlog"]) {
  const index = args.indexOf(flag);
  if (index >= 0) skip.add(index).add(index + 1);
}
const dirs = args.filter((a, i) => !skip.has(i) && !a.startsWith("--")).map(d => path.resolve(d));
if (dirs.length === 0) {
  console.error("usage: pnpm evals:gaps <run dir> [<run dir> ...] [--out file] [--backlog file | --no-backlog]");
  process.exit(2);
}
const runs: RunResult[] = [];
for (const dir of dirs) runs.push(JSON.parse(await readFile(path.join(dir, "results.json"), "utf8")) as RunResult);
const clusters = clusterGaps(collectGaps(runs));

let status: ((c: GapCluster) => string | undefined) | undefined;
if (!noBacklog) {
  const seenIn = runs.map(r => r.id).join("+");
  const update = updateBacklog(await loadBacklog(backlogFile), clusters, seenIn);
  await saveBacklog(backlogFile, update.backlog);
  status = c => {
    const entry = entryFor(update.backlog, c);
    return entry ? statusText(entry) : undefined;
  };
  for (const e of update.added) console.log(`new gap: ${e.key} (${e.cases} case${e.cases === 1 ? "" : "s"})`);
  for (const e of update.regressions)
    console.log(`REGRESSION: ${e.key} was built (${e.construct ?? "?"}) and is reported again by ${e.cases} case(s)`);
  if (update.regressions.length) process.exitCode = 1;
}
const markdown = gapsMarkdown(runs, clusters, status);
const file = path.resolve(out ?? path.join(dirs[0], "gaps.md"));
await writeFile(file, markdown);
console.log(markdown.split("\n## ")[0]);
console.log(
  `${clusters.length} clusters -> ${file}${noBacklog ? "" : `; backlog ${path.relative(process.cwd(), backlogFile)}`}`
);
