/**
 * The eval runner: for every case, build the base model, ask the proposer for a diff, validate it the way
 * `osl propose` does, check the expectations, generate on every backend, and (optionally) run the generated
 * app and the diff's own scenarios through the conformance harness.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  Model,
  applyDiff,
  compile,
  fromYaml,
  parseDiff,
  toYaml,
  type Diff,
  type Intent,
  type Model as ModelType
} from "@osl/core";
import {
  DEFAULT_MODEL,
  MAX_ATTEMPTS,
  ProposeDeclinedError,
  ProposeInvalidError,
  propose,
  validateCandidate,
  type ProposeUsage
} from "@osl/cli/propose";
import { implementActions } from "@osl/cli/implement";
import { BACKENDS, runFixture, type Fixture, type StepResult } from "@osl/conformance";
import type { Case } from "./cases.js";
import { actionLabels, checkExpectations, scenarioMetrics, type ScenarioMetrics } from "./checks.js";
import { costUsd } from "./pricing.js";

export type Proposer = "live" | "oracle" | "null";

export interface RunOptions {
  repoRoot: string;
  outDir: string;
  proposer: Proposer;
  model: string;
  /** Concurrent proposals */
  jobs: number;
  /** Concurrent full runs (each installs and starts an app) */
  fullJobs: number;
  /** Run the generated app and its scenarios on `backend` */
  full: boolean;
  backend: string;
  databaseUrl?: string;
  /** Write the action handlers with the model before the full run, so diffs with actions are measured too */
  implement?: boolean;
  /**
   * An earlier run directory whose proposals are reused: a case with a recorded diff is re-validated and graded
   * without asking Claude again, so a compiler or harness change can be measured on the same diffs
   */
  resumeFrom?: string;
  log: (line: string) => void;
}

export interface AttemptLog {
  attempt: number;
  yaml: string;
  problems: string[];
}

export interface CaseResult {
  id: string;
  tags: string[];
  base: string;
  /** ok: a valid diff. invalid: no valid diff within the attempts. error: the proposer failed for another reason. */
  status: "ok" | "invalid" | "declined" | "error";
  error?: string;
  expected_outcome: "ok" | "invalid" | "declined" | "any";
  /** Parts of the ask the agent said it could not express (live proposer only) */
  not_delivered: string[];
  /** The outcome matched the expectation and every check passed */
  pass: boolean;
  attempts: number;
  ms: number;
  usage: ProposeUsage;
  cost_usd: number | null;
  ops: number;
  op_kinds: string[];
  adds_actions: boolean;
  attempt_log: AttemptLog[];
  failures: string[];
  metrics: ScenarioMetrics | null;
  /** Backend -> generate step outcome */
  generate: Record<string, { ok: boolean; detail?: string }>;
  full?: { backend: string; ok: boolean; steps: StepResult[]; failed_step?: string; skipped?: string };
  /** The handlers the model wrote before the full run, when the run asked for it */
  implement?: {
    handlers: { handler: string; ok: boolean; attempts: number; skipped?: string }[];
    usage: ProposeUsage;
    cost_usd: number | null;
  };
  diff_file?: string;
}

export interface RunResult {
  id: string;
  started: string;
  finished: string;
  model: string;
  proposer: Proposer;
  backend: string;
  full: boolean;
  /** Whether handlers were written by the model before the full runs */
  implement?: boolean;
  /** The run whose proposals this one reused, when it did */
  resumed_from?: string;
  cases: CaseResult[];
}

const emptyUsage = (): ProposeUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0
});

/** The fixture intents a case starts from, in order, and the fixture they come from */
export async function baseIntents(
  repoRoot: string,
  c: Case
): Promise<{ name: string; ids: string[]; all: string[]; dir: string | null }> {
  if ("empty" in c.base) return { name: c.base.empty, ids: [], all: [], dir: null };
  const dir = path.join(repoRoot, "fixtures", c.base.fixture);
  const intentsDir = path.join(dir, "intents");
  if (!existsSync(intentsDir)) throw new Error(`${c.id}: fixture ${c.base.fixture} has no intents at ${intentsDir}`);
  const all = (await readdir(intentsDir)).filter(n => !n.startsWith(".")).sort();
  let ids = all;
  if (c.base.through) {
    const index = all.indexOf(c.base.through);
    if (index === -1) throw new Error(`${c.id}: fixture ${c.base.fixture} has no intent ${c.base.through}`);
    ids = all.slice(0, index + 1);
  }
  return { name: c.base.fixture, ids, all, dir };
}

/** Copy a fixture overlay, keeping only the action handlers in `keep` (all of them when null) */
async function copyOverlay(from: string, to: string, keep: Set<string> | null): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    const handlers = /(^|\/)src\/actions$/.test(from.split(path.sep).join("/"));
    if (handlers && keep) {
      // src/actions/<handler>.ts or src/actions/<handler>/handler.go
      const name = entry.isDirectory() ? entry.name : entry.name.replace(/\.[a-z]+$/, "");
      if (!keep.has(name)) continue;
    }
    if (entry.isDirectory()) await copyOverlay(source, target, keep);
    else {
      await mkdir(to, { recursive: true });
      await cp(source, target);
    }
  }
}

/** The fixture's model after the given intents, in order */
async function modelThrough(dir: string, name: string, ids: string[]): Promise<ModelType> {
  let model = Model.parse({ osl: "1.0", name, entities: {} });
  for (const id of ids) {
    const diff = parseDiff(fromYaml(await readFile(path.join(dir, "intents", id, "diff.yaml"), "utf8")));
    model = applyDiff(model, diff).model;
  }
  return model;
}

export async function baseModel(repoRoot: string, c: Case): Promise<ModelType> {
  const { name, ids, dir } = await baseIntents(repoRoot, c);
  let model = Model.parse({ osl: "1.0", name, entities: {} });
  if (dir) model = await modelThrough(dir, name, ids);
  return model;
}

type Proposed =
  | {
      status: "ok";
      diff: Diff;
      yaml: string;
      attempts: number;
      usage: ProposeUsage;
      log: AttemptLog[];
      notDelivered: string[];
    }
  | { status: "invalid"; attempts: number; usage: ProposeUsage; log: AttemptLog[]; problems: string[] }
  | { status: "declined"; attempts: number; usage: ProposeUsage; log: AttemptLog[]; reasons: string[] }
  | { status: "error"; error: string; attempts: number; usage: ProposeUsage; log: AttemptLog[] };

/** The proposal an earlier run recorded for a case, or null when that run never got to it */
async function recordedProposal(c: Case, base: ModelType, options: RunOptions): Promise<Proposed | null> {
  if (!options.resumeFrom) return null;
  const resultsFile = path.join(options.resumeFrom, "results.json");
  if (!existsSync(resultsFile)) throw new Error(`--resume: no results.json in ${options.resumeFrom}`);
  const prior = (JSON.parse(await readFile(resultsFile, "utf8")) as RunResult).cases.find(r => r.id === c.id);
  if (!prior || prior.status === "error") return null;
  const log = prior.attempt_log ?? [];
  if (prior.status === "invalid")
    return {
      status: "invalid",
      attempts: prior.attempts,
      usage: prior.usage,
      log,
      problems: prior.failures.map(f => f.replace(/^invalid: /, ""))
    };
  if (prior.status === "declined")
    return { status: "declined", attempts: prior.attempts, usage: prior.usage, log, reasons: prior.not_delivered };
  const diffFile = path.join(options.resumeFrom, "cases", c.id, "diff.yaml");
  if (!existsSync(diffFile)) return null;
  // Validated again, so a compiler change since the recording shows up as an invalid diff
  const yaml = await readFile(diffFile, "utf8");
  const { diff, problems } = validateCandidate(base, yaml);
  if (!diff || problems.length)
    return { status: "invalid", attempts: prior.attempts, usage: prior.usage, log, problems };
  return {
    status: "ok",
    diff,
    yaml,
    attempts: prior.attempts,
    usage: prior.usage,
    log,
    notDelivered: prior.not_delivered
  };
}

async function runProposer(c: Case, intent: Intent, base: ModelType, options: RunOptions): Promise<Proposed> {
  const log: AttemptLog[] = [];
  const recorded = await recordedProposal(c, base, options);
  if (recorded) return recorded;
  if (options.proposer === "live") {
    try {
      const result = await propose(c.id, intent, base, {
        model: options.model,
        onAttempt: (attempt, yaml, problems) => log.push({ attempt, yaml, problems })
      });
      return {
        status: "ok",
        diff: result.diff,
        yaml: result.yaml,
        attempts: result.attempts,
        usage: result.usage,
        log,
        notDelivered: result.notDelivered
      };
    } catch (error) {
      if (error instanceof ProposeInvalidError)
        return { status: "invalid", attempts: error.attempts, usage: error.usage, log, problems: error.problems };
      if (error instanceof ProposeDeclinedError)
        return { status: "declined", attempts: error.attempts, usage: error.usage, log, reasons: error.reasons };
      return {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        attempts: log.length,
        usage: emptyUsage(),
        log
      };
    }
  }
  let yaml: string;
  if (options.proposer === "oracle") {
    if (!c.oracle) return { status: "error", error: "case has no oracle diff", attempts: 0, usage: emptyUsage(), log };
    yaml = await readFile(path.join(options.repoRoot, c.oracle), "utf8");
  } else {
    yaml = 'osl: "1.0"\nops: []\n';
  }
  const { diff, problems } = validateCandidate(base, yaml);
  log.push({ attempt: 1, yaml, problems });
  if (diff && problems.length === 0)
    return { status: "ok", diff, yaml: toYaml(diff), attempts: 1, usage: emptyUsage(), log, notDelivered: [] };
  return { status: "invalid", attempts: 1, usage: emptyUsage(), log, problems };
}

/** Write a conformance fixture for the case: the base intents plus the proposed diff as a final intent */
async function writeCaseFixture(
  c: Case,
  diff: Diff,
  intent: Intent,
  caseDir: string,
  options: RunOptions
): Promise<Fixture> {
  const { name: fixtureName, ids, all, dir } = await baseIntents(options.repoRoot, c);
  // An oracle diff that is the fixture's own last intent needs the fixture's handlers too
  const oracleCompletes =
    options.proposer === "oracle" &&
    !!c.oracle &&
    all.length > 0 &&
    c.oracle.includes(`/intents/${all[all.length - 1]}/`);
  const fixtureDir = path.join(caseDir, "fixture");
  const intentsDir = path.join(fixtureDir, "intents");
  await mkdir(intentsDir, { recursive: true });
  for (const id of ids) await cp(path.join(dir!, "intents", id), path.join(intentsDir, id), { recursive: true });
  // The fixture's overlay holds the user-owned handlers of its final model. The base keeps the ones for the actions
  // it declares itself (their fields are the fixture's); a handler the proposed diff declares stays a stub, which
  // --implement then writes. An oracle diff that completes the fixture gets them all.
  if (dir && existsSync(path.join(dir, "overlay"))) {
    const keep = oracleCompletes
      ? null
      : new Set(compile(await modelThrough(dir, fixtureName, ids)).actions.map(a => a.handler));
    await copyOverlay(path.join(dir, "overlay"), path.join(fixtureDir, "overlay"), keep);
  }
  // Sorts after every fixture intent id (FEAT-, TODO-, WS-)
  const evalDir = path.join(intentsDir, "ZZ-EVAL");
  await mkdir(evalDir, { recursive: true });
  await writeFile(path.join(evalDir, "intent.yaml"), toYaml(intent));
  await writeFile(path.join(evalDir, "diff.yaml"), toYaml(diff));
  const name = c.id.replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  await writeFile(path.join(fixtureDir, "fixture.yaml"), toYaml({ name, backends: Object.keys(BACKENDS) }));
  return { name, dir: fixtureDir, backends: Object.keys(BACKENDS) };
}

export async function runCase(c: Case, options: RunOptions): Promise<CaseResult> {
  const caseDir = path.join(options.outDir, "cases", c.id);
  await mkdir(caseDir, { recursive: true });
  const base = await baseModel(options.repoRoot, c);
  const intent: Intent = { osl: "1.0", ...c.intent };
  const started = Date.now();
  const proposed = await runProposer(c, intent, base, options);
  const ms = Date.now() - started;
  await writeFile(path.join(caseDir, "attempts.json"), JSON.stringify(proposed.log, null, 2));

  const result: CaseResult = {
    id: c.id,
    tags: c.tags,
    base: "empty" in c.base ? "empty" : `${c.base.fixture}@${c.base.through ?? "all"}`,
    status: proposed.status,
    expected_outcome: c.expect.outcome,
    not_delivered:
      proposed.status === "ok" ? proposed.notDelivered : proposed.status === "declined" ? proposed.reasons : [],
    pass: false,
    attempts: proposed.attempts,
    ms,
    usage: proposed.usage,
    cost_usd: options.proposer === "live" ? costUsd(options.model, proposed.usage) : 0,
    ops: 0,
    op_kinds: [],
    adds_actions: false,
    attempt_log: proposed.log,
    failures: [],
    metrics: null,
    generate: {}
  };
  if (proposed.status === "error") {
    result.error = proposed.error;
    return result;
  }
  if (proposed.status === "invalid") {
    result.failures = proposed.problems.map(p => `invalid: ${p}`);
    result.pass = c.expect.outcome === "invalid" || c.expect.outcome === "any";
    return result;
  }
  if (proposed.status === "declined") {
    result.failures = proposed.reasons.map(r => `declined: ${r}`);
    result.pass = c.expect.outcome === "declined" || c.expect.outcome === "any";
    return result;
  }
  if (c.expect.outcome === "invalid") result.failures.push("a valid diff was not expected to exist");
  if (c.expect.outcome === "declined") result.failures.push("the agent was expected to decline");
  if (c.expect.flags_limit && proposed.notDelivered.length === 0)
    result.failures.push(
      "the ask has a part the model cannot express, and the diff did not say so (not_delivered is empty)"
    );

  const { diff } = proposed;
  result.ops = diff.ops.length;
  result.op_kinds = [...new Set(diff.ops.map(op => op.op))];

  result.diff_file = path.join(caseDir, "diff.yaml");
  await writeFile(result.diff_file, proposed.yaml);

  const model = applyDiff(base, diff).model;
  const ir = compile(model);
  // Actions arrive through add_action or inside an add_resource/update_resource payload; compare the models
  result.adds_actions = actionLabels(model).some(label => !actionLabels(base).includes(label));
  const checked = { base, model, ir, diff };
  result.failures.push(...checkExpectations(c.expect, checked));
  result.metrics = scenarioMetrics(checked);

  const fixture = await writeCaseFixture(c, diff, intent, caseDir, options);
  for (const backend of Object.keys(BACKENDS)) {
    const out = await runFixture(fixture, backend, { snapshotOnly: true, skipSnapshot: true });
    const generate = out.steps.find(s => s.step === "generate")!;
    result.generate[backend] = { ok: generate.ok, detail: generate.ok ? undefined : generate.detail };
    if (!generate.ok) result.failures.push(`generate on ${backend}: ${firstLine(generate.detail)}`);
  }
  result.pass = result.failures.length === 0;
  return result;
}

export async function runFull(c: Case, result: CaseResult, options: RunOptions): Promise<void> {
  const caseDir = path.join(options.outDir, "cases", c.id);
  const fixtureDir = path.join(caseDir, "fixture");
  if (result.status !== "ok" || !existsSync(fixtureDir)) return;
  if (!c.full) {
    result.full = { backend: options.backend, ok: true, steps: [], skipped: "case opts out" };
    return;
  }
  const raw = fromYaml<{ name: string }>(await readFile(path.join(fixtureDir, "fixture.yaml"), "utf8"));
  const fixture: Fixture = { name: raw.name, dir: fixtureDir, backends: [options.backend] };
  // The base's own stubs need writing too, not only the actions this diff adds
  const hasActions =
    compile(
      applyDiff(await baseModel(options.repoRoot, c), parseDiff(fromYaml(await readFile(result.diff_file!, "utf8"))))
        .model
    ).actions.length > 0;
  const lines: string[] = [];
  const out = await runFixture(fixture, options.backend, {
    skipSnapshot: true,
    databaseUrl: options.databaseUrl,
    keep: true,
    log: line => lines.push(line),
    afterInstall:
      options.implement && hasActions
        ? async dir => {
            const done = await implementActions(dir, BACKENDS[options.backend], {
              model: options.model,
              onAttempt: (handler, attempt, problems) =>
                lines.push(
                  `  implement ${handler} attempt ${attempt}: ${problems.length ? firstLine(problems[0]) : "ok"}`
                )
            });
            result.implement = {
              handlers: done.handlers.map(h => ({
                handler: h.handler,
                ok: h.ok,
                attempts: h.attempts,
                skipped: h.skipped
              })),
              usage: done.usage,
              cost_usd: costUsd(options.model, done.usage)
            };
            const written = done.handlers.filter(h => !h.skipped);
            return `${written.length} handler${written.length === 1 ? "" : "s"} written, ${written.filter(h => h.ok).length} passed the check`;
          }
        : undefined
  });
  await writeFile(path.join(caseDir, `full-${options.backend}.log`), lines.join("\n") + "\n");
  const failed = out.steps.find(s => !s.ok);
  result.full = { backend: options.backend, ok: out.ok, steps: out.steps, failed_step: failed?.step };
  if (!out.ok)
    result.failures.push(`full run on ${options.backend} failed at ${failed?.step}: ${firstLine(failed?.detail)}`);
  result.pass = result.failures.length === 0;
}

export async function runAll(cases: Case[], options: RunOptions): Promise<RunResult> {
  const started = new Date();
  await mkdir(options.outDir, { recursive: true });
  const results = new Map<string, CaseResult>();
  const saveAll = async () => {
    const run: RunResult = {
      id: path.basename(options.outDir),
      started: started.toISOString(),
      finished: new Date().toISOString(),
      model: options.model,
      proposer: options.proposer,
      backend: options.backend,
      full: options.full,
      implement: Boolean(options.implement),
      ...(options.resumeFrom ? { resumed_from: path.basename(options.resumeFrom) } : {}),
      cases: cases.map(c => results.get(c.id)).filter((r): r is CaseResult => !!r)
    };
    await writeFile(path.join(options.outDir, "results.json"), JSON.stringify(run, null, 2));
    return run;
  };

  await mapLimit(cases, options.jobs, async c => {
    const result = await runCase(c, options).catch(
      (error): CaseResult => ({
        id: c.id,
        tags: c.tags,
        base: "empty" in c.base ? "empty" : `${c.base.fixture}@${c.base.through ?? "all"}`,
        status: "error",
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        expected_outcome: c.expect.outcome,
        not_delivered: [],
        pass: false,
        attempts: 0,
        ms: 0,
        usage: emptyUsage(),
        cost_usd: null,
        ops: 0,
        op_kinds: [],
        adds_actions: false,
        attempt_log: [],
        failures: [],
        metrics: null,
        generate: {}
      })
    );
    results.set(c.id, result);
    options.log(describe(result));
    await saveAll();
  });

  if (options.full) {
    await mapLimit(
      cases.filter(c => results.get(c.id)?.status === "ok"),
      options.fullJobs,
      async c => {
        const result = results.get(c.id)!;
        await runFull(c, result, options).catch(error => {
          result.full = {
            backend: options.backend,
            ok: false,
            steps: [],
            failed_step: "harness",
            skipped: undefined
          };
          result.failures.push(`full run crashed: ${error instanceof Error ? error.message : String(error)}`);
          result.pass = false;
        });
        options.log(
          `  full ${c.id}: ${result.full?.ok ? "ok" : `FAIL at ${result.full?.failed_step}`}${
            result.full?.skipped ? ` (${result.full.skipped})` : ""
          }`
        );
        await saveAll();
      }
    );
  }
  return saveAll();
}

function describe(r: CaseResult): string {
  const head = `${r.pass ? "pass" : "FAIL"} ${r.id} [${r.status}, ${r.attempts} attempt${r.attempts === 1 ? "" : "s"}, ${r.ops} ops, ${(r.ms / 1000).toFixed(0)}s${
    r.cost_usd != null ? `, $${r.cost_usd.toFixed(3)}` : ""
  }]`;
  const details = r.error ? [`  error: ${firstLine(r.error)}`] : r.failures.map(f => `  - ${f}`);
  return [head, ...details].join("\n");
}

function firstLine(text: string | undefined): string {
  return (text ?? "").split("\n").find(l => l.trim()) ?? "";
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export { DEFAULT_MODEL, MAX_ATTEMPTS };
