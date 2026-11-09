#!/usr/bin/env node
/**
 * pnpm evals:gaps <run dir> [<run dir> ...] [--out file]
 *
 * Reads each run's results.json and writes gaps.md: what agents could not express, got wrong or failed to
 * run, clustered by topic and ranked by how many cases hit each cluster. Default output: gaps.md in the
 * first run directory.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gapReport } from "./gaps.js";
import type { RunResult } from "./runner.js";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
const dirs = args.filter((a, i) => a !== "--out" && (outIndex < 0 || i !== outIndex + 1)).map(d => path.resolve(d));
if (dirs.length === 0) {
  console.error("usage: pnpm evals:gaps <run dir> [<run dir> ...] [--out file]");
  process.exit(2);
}
const runs: RunResult[] = [];
for (const dir of dirs) runs.push(JSON.parse(await readFile(path.join(dir, "results.json"), "utf8")) as RunResult);
const { clusters, markdown } = gapReport(runs);
const file = path.resolve(out ?? path.join(dirs[0], "gaps.md"));
await writeFile(file, markdown);
console.log(markdown.split("\n## ")[0]);
console.log(`${clusters.length} clusters -> ${file}`);
