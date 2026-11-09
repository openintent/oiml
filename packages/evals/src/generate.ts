/**
 * Generated rounds: app ideas as eval cases, so each round of the gap-mining loop runs on asks the corpus has
 * not seen. Claude writes the intents from a seeded list of briefs (a domain, two constraints, a base); the
 * cases carry `outcome: any` plus a scenario minimum, so they grade generation and full runs, not a known answer.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { toYaml, type Model } from "@osl/core";
import { DEFAULT_MODEL, type ProposeUsage } from "@osl/cli/propose";
import { Case } from "./cases.js";
import { baseModel } from "./runner.js";

export const DOMAINS = [
  "a SaaS product for small teams",
  "a two-sided marketplace",
  "an internal operations tool",
  "a community or forum",
  "a content or publishing site",
  "a field service or logistics operation",
  "an education or course platform",
  "a personal productivity app",
  "a clinic or appointments practice",
  "a club or nonprofit with members and events"
];

export const CONSTRAINTS = [
  "teams or organisations as tenants, with roles inside them",
  "no sign-in at all",
  "email and password sign-in plus one social sign-in",
  "file uploads of some kind",
  "an operation beyond create, read, update and delete",
  "a dashboard with counts, or a board grouped by status",
  "an administrator who can do what ordinary members cannot",
  "a value that only the server may set, shown to everyone",
  "a many-to-many relationship",
  "public reading with private writing",
  "something that happens on a schedule or after a delay",
  "a total or count kept up to date as things change"
];

/** The fixtures a brief may extend, or a new app */
export const BASES = ["empty", "blog", "todo", "workspace"] as const;
export type BaseName = (typeof BASES)[number];

export interface Brief {
  index: number;
  base: BaseName;
  /** For a new app; an extension takes the fixture's own domain */
  domain?: string;
  constraints: string[];
}

/** Deterministic pseudo-random numbers, so a seed names a round's briefs */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** `count` briefs for a seed: half new apps, half extensions of a fixture, two constraints each */
export function briefs(count: number, seed: number): Brief[] {
  const rnd = lcg(seed);
  return Array.from({ length: count }, (_, i) => {
    const picks = new Set<string>();
    while (picks.size < 2) picks.add(CONSTRAINTS[Math.floor(rnd() * CONSTRAINTS.length)]);
    const extension = rnd() < 0.5;
    const base: BaseName = extension ? BASES[1 + Math.floor(rnd() * (BASES.length - 1))] : "empty";
    const brief: Brief = { index: i + 1, base, constraints: [...picks] };
    if (!extension) brief.domain = DOMAINS[Math.floor(rnd() * DOMAINS.length)];
    return brief;
  });
}

/** A fixture's model as a product person would read it: what exists, who may do what */
export function summarizeModel(model: Model): string {
  const entities = Object.fromEntries(
    Object.entries(model.entities).map(([name, e]) => [
      name,
      { fields: Object.keys(e.fields).join(", "), ...(e.rules ? { rules: e.rules } : {}) }
    ])
  );
  const resources = Object.fromEntries(
    Object.entries(model.resources).map(([name, r]) => [
      name,
      `${r.entity}: ${r.operations.join(", ")}${r.actions ? `; actions ${Object.keys(r.actions).join(", ")}` : ""}`
    ])
  );
  const summary: Record<string, unknown> = { entities, resources };
  if (model.auth)
    summary.auth = {
      identity: model.auth.identity,
      providers: model.auth.providers ?? [model.auth.provider],
      ...(model.auth.tenancy
        ? { tenancy: `${model.auth.tenancy.entity} through ${model.auth.tenancy.membership}` }
        : {})
    };
  if (Object.keys(model.actions ?? {}).length) summary.global_actions = Object.keys(model.actions);
  if (model.app?.pages) summary.pages = Object.keys(model.app.pages);
  return toYaml(summary).trim();
}

const GeneratedIntents = z.object({
  cases: z.array(
    z.object({
      index: z.number().int().describe("The brief's index"),
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+){0,4}$/)
        .describe("Two to four words, kebab-case, naming the app or feature"),
      tags: z
        .array(z.string().regex(/^[a-z][a-z0-9-]*$/))
        .max(5)
        .describe("Model areas the ask touches: entity, relation, rules, actions, auth, tenancy, files, app, events"),
      title: z.string().min(3).max(60),
      ask: z.string().min(40).describe("The request in prose, 60 to 140 words, as a product person writes it"),
      acceptance: z.array(z.string().min(10)).min(2).max(4).describe("Observable behaviour, one line each")
    })
  )
});

function systemPrompt(): string {
  return `You write feature requests used to evaluate an application generator. Each request is what a product person would send a developer: what the app or feature does for its users, who may do what, and acceptance criteria stated as observable behaviour (a status code, a visible value, something refused).

Rules:
- Plain product language. Never use the generator's vocabulary: no entity, field, resource, rule, scenario, diff, migration, endpoint, schema.
- Fit the brief: the domain (for a new app) or the existing app (for an extension, whose summary is given), and weave both constraints in as natural wants, not as a checklist.
- 60 to 140 words per ask, two to four acceptance criteria. Vary the shape: some asks are one paragraph of wants, some are a short story about the users.
- An extension must build on what the existing app already has; do not re-describe it.
- Write as real requests come: about one in four asks includes one want a schema-driven generator probably cannot satisfy on its own (live updates, payments, something happening later on a schedule, who may see a row depending on its state, a total that stays current), said the way a user would, without flagging it. The rest stay within ordinary application behaviour.
- One request per brief, in the brief's order, each with a distinct slug.`;
}

function userPrompt(round: Brief[], summaries: Partial<Record<BaseName, string>>): string {
  const parts: string[] = ["Briefs:", ""];
  for (const b of round) {
    parts.push(
      `${b.index}. ${b.base === "empty" ? `New app: ${b.domain}` : `Extension of the existing ${b.base} app`}. Constraints: ${b.constraints.join("; ")}.`
    );
  }
  const used = [...new Set(round.map(b => b.base).filter(b => b !== "empty"))] as BaseName[];
  for (const base of used) {
    parts.push("", `Existing ${base} app:`, "```yaml", summaries[base] ?? "", "```");
  }
  return parts.join("\n");
}

export interface GenerateOptions {
  repoRoot: string;
  /** Round name, also the folder under evals/propose/generated */
  round: string;
  count: number;
  seed: number;
  outDir: string;
  model?: string;
}

export interface GenerateResult {
  files: string[];
  ids: string[];
  briefs: Brief[];
  usage: ProposeUsage;
}

/** Write `count` generated cases for the round into `outDir/cases`, validated against the case schema */
export async function generateRound(options: GenerateOptions): Promise<GenerateResult> {
  const round = briefs(options.count, options.seed);
  const summaries: Partial<Record<BaseName, string>> = {};
  for (const base of new Set(round.map(b => b.base))) {
    if (base === "empty") continue;
    const model = await baseModel(options.repoRoot, { id: "generate", base: { fixture: base } } as never);
    summaries[base] = summarizeModel(model);
  }
  const client = new Anthropic({ maxRetries: 4 });
  const response = await client.messages.parse({
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(GeneratedIntents) },
    system: systemPrompt(),
    messages: [{ role: "user", content: userPrompt(round, summaries) }]
  });
  if (response.stop_reason === "max_tokens") throw new Error("the generated intents were cut off; ask for fewer");
  const generated = response.parsed_output;
  if (!generated) throw new Error("Claude returned no intents");
  const usage: ProposeUsage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0
  };

  const casesDir = path.join(options.outDir, "cases");
  await mkdir(casesDir, { recursive: true });
  const files: string[] = [];
  const ids: string[] = [];
  for (const brief of round) {
    const g = generated.cases.find(c => c.index === brief.index);
    if (!g) throw new Error(`Claude returned no intent for brief ${brief.index}`);
    const id = `gen-${options.round}-${String(brief.index).padStart(2, "0")}-${g.slug}`;
    const raw = {
      id,
      tags: [...new Set(["generated", `round-${options.round}`, ...g.tags])],
      base: brief.base === "empty" ? { empty: id } : { fixture: brief.base },
      intent: { title: g.title, ask: g.ask.trim(), acceptance: g.acceptance },
      expect: { outcome: "any", scenarios: { min: 1 } },
      notes: `Generated round ${options.round}, seed ${options.seed}, brief ${brief.index}: ${
        brief.base === "empty" ? brief.domain : `extension of ${brief.base}`
      }; ${brief.constraints.join("; ")}.`
    };
    const parsed = Case.safeParse(raw);
    if (!parsed.success)
      throw new Error(
        `generated case ${id} is not a valid case: ${parsed.error.issues.map(i => i.message).join("; ")}`
      );
    const file = path.join(casesDir, `${id}.yaml`);
    await writeFile(file, toYaml(raw));
    files.push(file);
    ids.push(id);
  }
  await writeFile(
    path.join(options.outDir, "round.yaml"),
    toYaml({
      round: options.round,
      seed: options.seed,
      count: options.count,
      model: options.model ?? DEFAULT_MODEL,
      briefs: round
    })
  );
  return { files, ids, briefs: round, usage };
}
