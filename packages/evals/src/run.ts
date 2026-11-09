#!/usr/bin/env node
/**
 * pnpm evals [--proposer live|oracle|null] [--model id] [--only a,b] [--tag t] [--limit n]
 *            [--no-full] [--implement] [--backend name] [--jobs n] [--full-jobs n] [--cases dir] [--out dir]
 *            [--compare <run dir>]
 *
 * Reads ANTHROPIC_API_KEY and OSL_TEST_DATABASE_URL from the environment, .env.local and .env.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadCases } from "./cases.js";
import { compareRuns, summaryMarkdown } from "./report.js";
import { DEFAULT_MODEL, runAll, type Proposer, type RunResult } from "./runner.js";

const args = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (flag: string) => args.includes(flag);

const repoRoot = path.resolve(process.env.OSL_REPO_ROOT ?? process.cwd());
loadEnv(path.join(repoRoot, ".env.local"));
loadEnv(path.join(repoRoot, ".env"));

const casesDir = path.resolve(valueOf("--cases") ?? path.join(repoRoot, "evals/propose/cases"));
const proposer = (valueOf("--proposer") ?? "live") as Proposer;
if (!["live", "oracle", "null"].includes(proposer)) {
  console.error(`--proposer must be live, oracle or null, not ${proposer}`);
  process.exit(2);
}
const model = valueOf("--model") ?? DEFAULT_MODEL;
const full = !has("--no-full");
const implement = has("--implement");
const backend = valueOf("--backend") ?? "hono-trpc-vite";
const jobs = Number(valueOf("--jobs") ?? 4);
const fullJobs = Number(valueOf("--full-jobs") ?? 2);
const only = valueOf("--only")
  ?.split(",")
  .map(s => s.trim())
  .filter(Boolean);
const tag = valueOf("--tag");
const limit = valueOf("--limit") ? Number(valueOf("--limit")) : undefined;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.resolve(valueOf("--out") ?? path.join(repoRoot, "evals/propose/runs", `${stamp}-${proposer}`));

if ((proposer === "live" || implement) && !process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY is not set; put it in .env.local or run with --proposer oracle|null and without --implement"
  );
  process.exit(2);
}
const databaseUrl = process.env.OSL_TEST_DATABASE_URL;
if (full && !databaseUrl) console.error("OSL_TEST_DATABASE_URL is not set; full runs will fail at the database step");

let cases = await loadCases(casesDir);
if (only) cases = cases.filter(c => only.includes(c.id));
if (tag) cases = cases.filter(c => c.tags.includes(tag));
if (proposer === "oracle") cases = cases.filter(c => c.oracle);
if (limit) cases = cases.slice(0, limit);
if (cases.length === 0) {
  console.error("no cases selected");
  process.exit(2);
}

console.log(
  `${cases.length} cases, proposer ${proposer}${proposer === "live" ? ` (${model})` : ""}, ${
    full ? `full runs on ${backend}${implement ? ` with handlers written by ${model}` : ""}` : "no full runs"
  }\n-> ${outDir}\n`
);
await mkdir(outDir, { recursive: true });
const run = await runAll(cases, {
  repoRoot,
  outDir,
  proposer,
  model,
  jobs,
  fullJobs,
  full,
  implement,
  backend,
  databaseUrl,
  log: line => console.log(line)
});
const summary = summaryMarkdown(run);
await writeFile(path.join(outDir, "summary.md"), summary);
console.log(`\n${summary.split("\n## Cases")[0]}`);
console.log(`Full report: ${path.join(outDir, "summary.md")}`);

const compareWith = valueOf("--compare");
if (compareWith) {
  const before = JSON.parse(await readFile(path.join(path.resolve(compareWith), "results.json"), "utf8")) as RunResult;
  const comparison = compareRuns(before, run);
  await writeFile(path.join(outDir, "compare.md"), comparison);
  console.log(`\n${comparison}`);
}
process.exit(run.cases.every(c => c.pass) ? 0 : 1);

function loadEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
