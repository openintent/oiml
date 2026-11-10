/**
 * osl implement: write the action handlers, the logic no schema can express.
 * One Claude call per handler with the action's declaration, the scenarios that call it and the generated
 * files it may use; the backend's check commands verify the file, and their output goes back on a failure.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import {
  loadProject,
  toYaml,
  userActions,
  type ActionIR,
  type Backend,
  type Cmd,
  type HandlerGuide,
  type Project
} from "@osl/core";
import { DEFAULT_MODEL, type ProposeUsage } from "./propose.js";

/** The compiler output usually names the one thing to fix; a third round rarely helps. */
export const MAX_HANDLER_ATTEMPTS = 3;

const HandlerFile = z.object({
  source: z
    .string()
    .describe("The complete handler file that replaces the stub, keeping the exported function's name and signature"),
  notes: z.string().describe("One or two lines on what the handler does and any assumption it makes")
});

export interface ImplementOptions {
  model?: string;
  /** Handlers to write, by name (posts_publish); default: every handler still at its generated stub */
  only?: string[];
  /** Also rewrite handlers that are no longer stubs */
  force?: boolean;
  /** Run the backend's check commands after writing (default true); needs the project's dependencies installed */
  check?: boolean;
  maxAttempts?: number;
  /** Called after each attempt with the check problems, empty when it passed */
  onAttempt?: (handler: string, attempt: number, problems: string[]) => void;
}

export interface HandlerResult {
  handler: string;
  path: string;
  ok: boolean;
  attempts: number;
  usage: ProposeUsage;
  /** The check output when the handler still fails */
  problems: string[];
  notes?: string;
  /** Why nothing was written */
  skipped?: string;
}

export interface ImplementResult {
  handlers: HandlerResult[];
  /** Token usage summed over every handler and attempt */
  usage: ProposeUsage;
}

/** Everything the prompt for one handler is built from */
export interface HandlerContext {
  action: ActionIR;
  /** The handler file, relative to the project root */
  path: string;
  /** The generated stub, which the written file replaces */
  stub: string;
  /** Whether the file on disk is still the stub (or missing) */
  isStub: boolean;
  declaration: string;
  entities: string;
  scenarios: string;
  files: { path: string; content: string }[];
  language: string;
}

export interface HandlerPlan {
  project: Project;
  guide: HandlerGuide;
  system: string;
  handlers: HandlerContext[];
}

const emptyUsage = (): ProposeUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0
});

function addUsage(total: ProposeUsage, usage: Anthropic.Messages.Usage | ProposeUsage): void {
  total.input_tokens += usage.input_tokens;
  total.output_tokens += usage.output_tokens;
  total.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
  total.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
}

/** `posts.publish` or `actions.send_digest`: how scenario steps name the action */
export function actionLabel(action: ActionIR): string {
  return action.resource ? `${action.resource}.${action.name}` : `actions.${action.name}`;
}

export function systemPrompt(backendName: string, guide: HandlerGuide): string {
  return `You write one action handler in an application that OSL generated from a declared model, for the ${backendName} stack. Everything around the handler exists: routing, input validation, the access rule, the session, the database client and the contract tests. The handler is the logic the model cannot express.

Rules:
- Return the complete file. Keep the exported function's name and signature and the stub's import style; add only imports from the generated modules shown and from the libraries the project already uses.
- Implement what the action's description and the scenarios ask, nothing more. A scenario's expected body shows the shape to return; a scenario's expected status shows when to fail.
- Do not re-check the access rule or re-validate the input: the route did both before calling the handler.
- When the action returns the entity, write the change to the database and return the fresh row from the database, not a mutated copy.
- Answer with a status only for a state the request cannot proceed from (400 a bad state, 404 a missing related row, 409 a conflict), using the error helper the conventions name.
- No new dependencies, no other files, no comments that restate the code.

Conventions of this stack:
${guide.conventions}`;
}

export function userPrompt(c: HandlerContext, previous?: { source: string; problems: string[] }): string {
  const fence = (lang: string, text: string) => ["```" + lang, text.trimEnd(), "```"].join("\n");
  const parts = [
    `Action ${actionLabel(c.action)}: ${c.action.method} ${c.action.path}; handler file ${c.path}.`,
    ...(c.action.description ? [`Description: ${c.action.description}`] : []),
    "",
    "Declaration in the model:",
    fence("yaml", c.declaration),
    "",
    "Entities involved:",
    fence("yaml", c.entities),
    "",
    c.scenarios
      ? `Scenarios that call it (the contract tests; expected bodies are subsets):\n${fence("yaml", c.scenarios)}`
      : "No scenario calls this action yet; follow the description.",
    "",
    "The stub to replace:",
    fence(c.language, c.stub),
    "",
    "Generated files you may use:",
    ...c.files.flatMap(f => ["", `### ${f.path}`, fence(c.language, f.content)])
  ];
  if (previous) {
    parts.push(
      "",
      "Your previous file did not pass the check. Fix every problem and return the complete file again.",
      "",
      "Previous file:",
      fence(c.language, previous.source),
      "",
      "Check output:",
      fence("", previous.problems.join("\n"))
    );
  }
  return parts.join("\n");
}

/** The YAML of the action as the model declares it, under its resource when it has one */
function declarationYaml(project: Project, action: ActionIR): string {
  if (action.resource) {
    const resource = project.model.resources[action.resource];
    return toYaml({
      resources: {
        [action.resource]: {
          entity: resource.entity,
          path: resource.path,
          actions: { [action.name]: resource.actions?.[action.name] }
        }
      }
    });
  }
  return toYaml({ actions: { [action.name]: project.model.actions[action.name] } });
}

/** The action's entity, or every entity for a global action that names none */
function entitiesYaml(project: Project, action: ActionIR): string {
  const names = action.entity ? [action.entity] : Object.keys(project.model.entities);
  return toYaml({ entities: Object.fromEntries(names.map(n => [n, project.model.entities[n]])) });
}

function scenariosYaml(project: Project, action: ActionIR): string {
  const label = actionLabel(action);
  const scenarios = (project.model.examples?.scenarios ?? []).filter(s => s.steps.some(step => step.op === label));
  return scenarios.length ? toYaml(scenarios) : "";
}

/**
 * What `implementActions` would do, without calling Claude: the handlers in scope with everything their prompts
 * are built from. `only` narrows to the named handlers; without `force`, handlers that are no longer stubs are left out.
 */
export async function planHandlers(
  root: string,
  backend: Backend,
  options: Pick<ImplementOptions, "only" | "force"> = {}
): Promise<HandlerPlan> {
  const project = await loadProject(root);
  const files = backend.generate({ ir: project.ir, revisions: project.lock.revisions, config: project.config });
  const guide = backend.handlerGuide(project.config);
  const context: { path: string; content: string }[] = [];
  for (const file of guide.files) {
    const full = path.join(root, file);
    if (existsSync(full)) context.push({ path: file, content: await readFile(full, "utf8") });
  }
  const handlers: HandlerContext[] = [];
  for (const action of userActions(project.ir)) {
    const pattern = new RegExp(`/actions/${action.handler}(\\.|/)`);
    const scaffold = files.find(f => f.mode === "scaffold" && pattern.test(f.path));
    if (!scaffold) continue;
    if (options.only && !options.only.includes(action.handler)) continue;
    const target = path.join(root, scaffold.path);
    const current = existsSync(target) ? await readFile(target, "utf8") : null;
    const isStub = current === null || current === scaffold.content;
    if (!isStub && !options.force) continue;
    handlers.push({
      action,
      path: scaffold.path,
      stub: scaffold.content,
      isStub,
      declaration: declarationYaml(project, action),
      entities: entitiesYaml(project, action),
      scenarios: scenariosYaml(project, action),
      files: context,
      language: guide.language
    });
  }
  return { project, guide, system: systemPrompt(backend.name, guide), handlers };
}

function run(cmd: Cmd, cwd: string): Promise<{ code: number; output: string; missing: boolean }> {
  return new Promise(resolve => {
    const child = spawn(cmd.command, cmd.args, {
      cwd,
      env: { ...process.env, ...cmd.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", d => (output += d));
    child.stderr.on("data", d => (output += d));
    child.on("error", error => resolve({ code: 127, output: error.message, missing: true }));
    child.on("close", code => resolve({ code: code ?? 1, output, missing: false }));
  });
}

/** Run the backend's check commands; the problems are the first failing command's output, trimmed to its tail */
async function check(root: string, commands: Cmd[]): Promise<{ problems: string[]; unavailable?: string }> {
  for (const cmd of commands) {
    const result = await run(cmd, root);
    if (result.missing) return { problems: [], unavailable: `${cmd.command} is not installed here` };
    if (result.code !== 0) {
      const lines = result.output.split("\n").filter(l => l.trim());
      return { problems: [`${cmd.command} ${cmd.args.join(" ")} exited ${result.code}`, ...lines.slice(-60)] };
    }
  }
  return { problems: [] };
}

/** gofmt the file when the stack is Go, so formatting never counts as a failed attempt */
async function format(root: string, file: string): Promise<void> {
  if (!file.endsWith(".go")) return;
  await run({ command: "gofmt", args: ["-w", file] }, root);
}

/**
 * Write the handlers of `root`'s project: by default those still at their stubs, with `only` the named ones.
 * Files are written in place; a handler that fails the check keeps its last attempt, with the problems reported.
 */
export async function implementActions(
  root: string,
  backend: Backend,
  options: ImplementOptions = {}
): Promise<ImplementResult> {
  const plan = await planHandlers(root, backend, options);
  const runtime = backend.runtime(plan.project.config);
  const modelId = options.model ?? DEFAULT_MODEL;
  const maxAttempts = options.maxAttempts ?? MAX_HANDLER_ATTEMPTS;
  const total = emptyUsage();
  const results: HandlerResult[] = [];
  const client = new Anthropic({ maxRetries: 4 });

  // Handlers already filled in are reported, not rewritten
  if (!options.force) {
    const planned = new Set(plan.handlers.map(h => h.action.handler));
    for (const action of userActions(plan.project.ir)) {
      if (planned.has(action.handler) || (options.only && !options.only.includes(action.handler))) continue;
      const file = `src/actions/${action.handler}`;
      results.push({
        handler: action.handler,
        path: file,
        ok: true,
        attempts: 0,
        usage: emptyUsage(),
        problems: [],
        skipped: "already implemented (pass --force to rewrite)"
      });
    }
  }

  for (const ctx of plan.handlers) {
    const { action } = ctx;
    const target = path.join(root, ctx.path);
    const usage = emptyUsage();
    const base = { handler: action.handler, path: ctx.path, usage, problems: [] as string[] };
    let previous: { source: string; problems: string[] } | undefined;
    let done = false;
    for (let attempt = 1; attempt <= maxAttempts && !done; attempt++) {
      const response = await client.messages.parse({
        model: modelId,
        max_tokens: 8000,
        output_config: { effort: "high", format: zodOutputFormat(HandlerFile) },
        system: [{ type: "text", text: plan.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt(ctx, previous) }]
      });
      addUsage(usage, response.usage);
      if (response.stop_reason === "refusal")
        throw new Error(
          `Claude declined to write ${action.handler}${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ""}`
        );
      if (response.stop_reason === "max_tokens")
        throw new Error(`the handler ${action.handler} was cut off at max_tokens`);
      const parsed = response.parsed_output;
      if (!parsed) throw new Error(`Claude returned no handler for ${action.handler}`);
      const source = parsed.source.trimEnd() + "\n";
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, source);
      await format(root, ctx.path);
      const outcome = options.check === false ? { problems: [] } : await check(root, runtime.check);
      options.onAttempt?.(action.handler, attempt, outcome.problems);
      if (outcome.problems.length === 0) {
        done = true;
        results.push({
          ...base,
          ok: true,
          attempts: attempt,
          notes: outcome.unavailable ? `${parsed.notes} (check skipped: ${outcome.unavailable})` : parsed.notes
        });
      } else {
        previous = { source, problems: outcome.problems };
        base.problems = outcome.problems;
      }
    }
    if (!done) results.push({ ...base, ok: false, attempts: maxAttempts });
    addUsage(total, usage);
  }
  return { handlers: results, usage: total };
}
