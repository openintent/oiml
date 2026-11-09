#!/usr/bin/env node
/**
 * pnpm evals:generate [--round name] [--count n] [--seed n] [--model id] [--out dir]
 *
 * Writes a round of generated intents as eval cases under evals/propose/generated/<round>/cases, then
 * `pnpm evals --cases <that folder>` runs them like any other cases. Reads ANTHROPIC_API_KEY from the
 * environment, .env.local and .env.
 */
import path from "node:path";
import { DEFAULT_MODEL } from "@osl/cli/propose";
import { loadRepoEnv } from "./env.js";
import { generateRound } from "./generate.js";

const args = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const repoRoot = path.resolve(process.env.OSL_REPO_ROOT ?? process.cwd());
loadRepoEnv(repoRoot);
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set; put it in .env.local");
  process.exit(2);
}
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const round = (valueOf("--round") ?? `r${stamp}`).replace(/[^a-z0-9]/gi, "").toLowerCase();
const count = Number(valueOf("--count") ?? 10);
const seed = Number(valueOf("--seed") ?? Date.now() % 1_000_000);
const model = valueOf("--model") ?? DEFAULT_MODEL;
const outDir = path.resolve(valueOf("--out") ?? path.join(repoRoot, "evals/propose/generated", round));

console.log(`round ${round}: ${count} intents from seed ${seed} with ${model}\n-> ${outDir}\n`);
const result = await generateRound({ repoRoot, round, count, seed, outDir, model });
for (const [i, id] of result.ids.entries()) {
  const brief = result.briefs[i];
  console.log(`  ${id}  (${brief.base === "empty" ? brief.domain : `extends ${brief.base}`})`);
}
console.log(
  `\n${result.ids.length} cases written; tokens ${result.usage.input_tokens.toLocaleString()} in, ${result.usage.output_tokens.toLocaleString()} out`
);
console.log(`next: pnpm evals --cases ${path.relative(process.cwd(), path.join(outDir, "cases"))} --implement`);
