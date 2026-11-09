#!/usr/bin/env node
/**
 * pnpm evals:next [--from <round folder | run dir>] [--backlog file] [--gap key]
 *
 * The brief for the next construct: the top open gap in the backlog, with the lines agents wrote, the cases that
 * hit it, the design questions to settle and what done looks like. No model call; a template over the backlog
 * and the latest gap report.
 */
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { BACKLOG_FILE, loadBacklog, openGaps } from "./backlog.js";
import { clusterGaps, collectGaps } from "./gaps.js";
import { ROUNDS_DIR, readRun } from "./round.js";

const args = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const repoRoot = path.resolve(process.env.OSL_REPO_ROOT ?? process.cwd());
const backlog = await loadBacklog(path.resolve(valueOf("--backlog") ?? path.join(repoRoot, BACKLOG_FILE)));
const open = openGaps(backlog);
if (open.length === 0) {
  console.log("The backlog has no open gap. Run a round (pnpm evals:round) or mark one open again.");
  process.exit(0);
}
const wanted = valueOf("--gap");
const gap = wanted ? open.find(g => g.key === wanted) : open[0];
if (!gap) {
  console.error(`no open gap named "${wanted}"; open gaps: ${open.map(g => g.key).join("; ")}`);
  process.exit(2);
}

/** The latest results: --from, else the most recent round with a run, else the most recent run directory */
async function latestResults(): Promise<string | undefined> {
  const from = valueOf("--from");
  if (from) {
    const dir = path.resolve(from);
    if (existsSync(path.join(dir, "results.json"))) return dir;
    if (existsSync(path.join(dir, "run", "results.json"))) return path.join(dir, "run");
    throw new Error(`${from} has no results.json (nor run/results.json)`);
  }
  const candidates: { dir: string; mtime: number }[] = [];
  for (const root of [path.join(repoRoot, ROUNDS_DIR), path.join(repoRoot, "evals/propose/runs")]) {
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const results of [
        path.join(root, entry.name, "run", "results.json"),
        path.join(root, entry.name, "results.json")
      ])
        if (existsSync(results)) candidates.push({ dir: path.dirname(results), mtime: (await stat(results)).mtimeMs });
    }
  }
  return candidates.sort((a, b) => b.mtime - a.mtime)[0]?.dir;
}

const source = await latestResults();
const cluster = source
  ? clusterGaps(collectGaps([await readRun(source)])).find(c => c.key === gap.key && c.kind === gap.kind)
  : undefined;

const lines = [
  `# Next construct: ${gap.key}`,
  "",
  `Open since ${gap.first_seen}, last seen ${gap.last_seen}, ${gap.cases} case${gap.cases === 1 ? "" : "s"} when last seen.` +
    (gap.note ? ` Note: ${gap.note}` : ""),
  ""
];
if (cluster) {
  lines.push(`## What agents wrote (${path.relative(repoRoot, source!)})`, "");
  for (const e of cluster.examples) lines.push(`> ${e.replace(/\n/g, " ")}`, ">");
  lines.pop();
  lines.push("", `Cases: ${cluster.cases.join(", ")}`, "");
} else lines.push("No current report mentions it; run a round or pass --from.", "");
lines.push(
  "## Design questions to settle first",
  "",
  "- Where does it live in the grammar (a rule predicate, a field property, a resource option, a new section), and what does the smallest spelling look like in a diff?",
  "- Which diagnostics make a wrong use fail validation rather than run (codes, messages that say what to change)?",
  "- What does each backend emit for it (drizzle-next, hono-trpc-vite, gin-pgx), including the list filter, the create path and the web pages where they apply?",
  "- Does every backend have a deterministic mapping? If not, this becomes a declined entry with a reference sentence that says what to do instead, and the construct is not built.",
  "",
  "## Done looks like",
  "",
  "- A fixture intent with scenarios that show the construct from the allowed and the refused side, proven on all three backends (pnpm conformance 9/9, snapshots updated).",
  "- An eval case with the fixture's diff as oracle, plus one new ask over another base; pnpm evals --proposer oracle --no-full passes.",
  `- pnpm evals --resume ${source ? path.relative(repoRoot, source) : "<the last round's run folder>"} --implement loses no case, and a fresh round no longer reports "${gap.key}" (then mark it built in evals/propose/gaps.yaml with the construct and version).`,
  "- A reference paragraph in packages/core/src/reference.ts, docs/model.md regenerated, the rows in README.md and docs/backends.md.",
  "",
  "The rule: a gap becomes a construct only with a deterministic mapping on every backend; the harness, not the model, says when it is done."
);
console.log(lines.join("\n"));
