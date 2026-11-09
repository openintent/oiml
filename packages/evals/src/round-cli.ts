#!/usr/bin/env node
/**
 * pnpm evals:round [--round name] [--count n] [--seed n] [--model id] [--no-full] [--no-implement]
 *                  [--backend name] [--previous round] [--max-cost usd] [--jobs n] [--full-jobs n]
 *
 * One turn of the loop: generate a round of intents, run them with handlers written by the model, write the
 * gap report, update the backlog and compare with the previous round. Exit code 1 when a built gap reappears.
 * Reads ANTHROPIC_API_KEY and OSL_TEST_DATABASE_URL from the environment, .env.local and .env.
 */
import path from "node:path";
import { DEFAULT_MODEL } from "@osl/cli/propose";
import { loadRepoEnv } from "./env.js";
import { roundText, runRound } from "./round.js";

const args = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (flag: string) => args.includes(flag);

const repoRoot = path.resolve(process.env.OSL_REPO_ROOT ?? process.cwd());
loadRepoEnv(repoRoot);
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set; put it in .env.local");
  process.exit(2);
}
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const round = (valueOf("--round") ?? `r${stamp}`).toLowerCase().replace(/[^a-z0-9-]/g, "");
const full = !has("--no-full");
const databaseUrl = process.env.OSL_TEST_DATABASE_URL;
if (full && !databaseUrl) console.error("OSL_TEST_DATABASE_URL is not set; full runs will fail at the database step");

const summary = await runRound({
  repoRoot,
  round,
  count: Number(valueOf("--count") ?? 10),
  seed: Number(valueOf("--seed") ?? Date.now() % 1_000_000),
  model: valueOf("--model") ?? DEFAULT_MODEL,
  full,
  implement: full && !has("--no-implement"),
  backend: valueOf("--backend") ?? "hono-trpc-vite",
  databaseUrl,
  previous: valueOf("--previous"),
  maxCostUsd: Number(valueOf("--max-cost") ?? 15),
  jobs: Number(valueOf("--jobs") ?? 4),
  fullJobs: Number(valueOf("--full-jobs") ?? 2),
  log: line => console.log(line)
});
console.log(`\n${roundText(summary)}`);
console.log(
  `\nFolder: ${path.relative(process.cwd(), summary.dir)} (gaps.md, run/summary.md${summary.changes ? ", compare-gaps.md" : ""})`
);
process.exit(summary.regressions.length ? 1 : 0);
