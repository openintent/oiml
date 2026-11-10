/**
 * osl propose: turn an intent's prose into a model diff for review.
 * One streamed Claude call with structured output, validated locally, one retry on validation errors.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import {
  DIFF_REFERENCE,
  Diff,
  ModelError,
  applyDiff,
  compile,
  formatDiagnostics,
  fromYaml,
  toYaml,
  type Intent,
  type Model
} from "@osl/core";

export const DEFAULT_MODEL = "claude-opus-5-5";
/**
 * The cap on one answer's output tokens, thinking included. A long diff after long thinking passed the 16,000 this
 * began at. The request streams, which the SDK requires of a cap this size.
 */
export const DEFAULT_MAX_TOKENS = 64000;
/** One retry with the validation problems is usually enough; more hides a reference-text gap. */
export const MAX_ATTEMPTS = 2;

const Proposal = z.object({
  summary: z.string().describe("One line on what the diff changes"),
  diff_yaml: z
    .string()
    .nullable()
    .describe(
      'The complete diff document as YAML, starting with osl: "1.0"; null when nothing in the ask can be expressed'
    ),
  not_delivered: z
    .array(z.string())
    .describe("Parts of the ask the model cannot express, one line each; empty when the diff delivers everything")
});

export interface ProposeOptions {
  model?: string;
  /** The cap on one answer's output tokens, thinking included; default DEFAULT_MAX_TOKENS */
  maxTokens?: number;
  /** The client to ask, for tests; default: one made from the environment */
  client?: Anthropic;
  /** Called with each attempt's raw YAML, for logs */
  onAttempt?: (attempt: number, yaml: string, problems: string[]) => void;
}

export interface ProposeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface ProposeResult {
  diff: Diff;
  yaml: string;
  attempts: number;
  /** Token usage summed over every attempt */
  usage: ProposeUsage;
  /** Parts of the ask the agent could not express in the model, for the person reviewing the diff */
  notDelivered: string[];
}

/** The agent found nothing in the ask that the model can express, and said why. */
export class ProposeDeclinedError extends Error {
  constructor(
    readonly reasons: string[],
    readonly attempts: number,
    readonly usage: ProposeUsage
  ) {
    super(`nothing to propose:\n  ${reasons.join("\n  ")}`);
    this.name = "ProposeDeclinedError";
  }
}

/** The proposal was still invalid after the last attempt; carries what was tried, for logs and evals. */
export class ProposeInvalidError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly problems: string[],
    readonly usage: ProposeUsage
  ) {
    super(message);
    this.name = "ProposeInvalidError";
  }
}

/** The answer reached the output token cap before it ended; carries the cap and what was spent, for logs and evals. */
export class ProposeCutOffError extends Error {
  constructor(
    readonly maxTokens: number,
    readonly attempts: number,
    readonly usage: ProposeUsage
  ) {
    super(
      `the proposal was cut off at max_tokens (${maxTokens}); raise the cap with --max-tokens or split the intent into smaller ones`
    );
    this.name = "ProposeCutOffError";
  }
}

const emptyUsage = (): ProposeUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0
});

function addUsage(total: ProposeUsage, usage: Anthropic.Messages.Usage): void {
  total.input_tokens += usage.input_tokens;
  total.output_tokens += usage.output_tokens;
  total.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
  total.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
}

/** The SDK's structured-output parse failures, as opposed to API errors */
export function isParseFailure(error: unknown): boolean {
  return error instanceof Error && /Failed to parse structured output/i.test(error.message);
}

function systemPrompt(): string {
  return `You turn feature requests into OSL model diffs. OSL compiles a declared application model into working code, so a diff is the whole change: entities, fields, relations, access rules, resources, auth, events and example scenarios that become contract tests.

Rules:
- Output only a diff document that follows the reference. Do not invent keys.
- Prefer the smallest diff that fully delivers the request and its acceptance criteria.
- Reuse existing entities, resources and relations from the current model; never re-add what exists.
- Every new entity gets an id field (uuid primary unless the model uses integer ids) and a created_at datetime with default now, unless the request says otherwise.
- Protect data: use owner rules for user-owned rows, authenticated for writes when auth exists, and never expose hidden fields.
- Write at least one scenario per feature with concrete values. Cover the happy path and one rejection (400, 401, 403, 404 or 409) that the acceptance criteria describe. Scenarios that sign in need actors; add them with set_actors when none exist.
- Use "{actor.id}" for the acting user's id and capture ids you need later.
- When part of the ask has no construct in the model (the reference says what rules, resources and pages can express), deliver the rest and list each missing part in not_delivered, one plain line each. When nothing can be expressed, return null for diff_yaml and say why in not_delivered. Never invent keys and never pad a diff just to return something.

${DIFF_REFERENCE}`;
}

function userPrompt(
  intentId: string,
  intent: Intent,
  model: Model,
  previousProblems?: string[],
  previousYaml?: string
): string {
  const parts = [
    `Intent ${intentId}: ${intent.title}`,
    "",
    intent.ask.trim(),
    ...(intent.acceptance?.length ? ["", "Acceptance criteria:", ...intent.acceptance.map(a => `- ${a}`)] : []),
    "",
    "Current model (.osl/model.yaml):",
    "```yaml",
    toYaml(model).trim(),
    "```"
  ];
  if (previousProblems && previousYaml !== undefined) {
    parts.push("", "Your previous answer was rejected. Fix every problem and return the whole diff again.");
    if (previousYaml.trim()) parts.push("", "Previous diff:", "```yaml", previousYaml.trim(), "```");
    parts.push("", "Problems:", ...previousProblems.map(p => `- ${p}`));
  }
  return parts.join("\n");
}

/** Parse, apply and compile a candidate diff. Returns the problems found, empty when it is valid. */
export function validateCandidate(model: Model, yaml: string): { diff?: Diff; problems: string[] } {
  let raw: unknown;
  try {
    raw = fromYaml(yaml);
  } catch (error) {
    return { problems: [`not valid YAML: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const parsed = Diff.safeParse(raw);
  if (!parsed.success) {
    return { problems: parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  try {
    const applied = applyDiff(model, parsed.data);
    compile(applied.model);
  } catch (error) {
    if (error instanceof ModelError)
      return {
        diff: parsed.data,
        problems: formatDiagnostics(error.diagnostics)
          .split("\n")
          .map(l => l.trim())
      };
    return { diff: parsed.data, problems: [error instanceof Error ? error.message : String(error)] };
  }
  return { diff: parsed.data, problems: [] };
}

export async function propose(
  intentId: string,
  intent: Intent,
  model: Model,
  options: ProposeOptions = {}
): Promise<ProposeResult> {
  const client = options.client ?? new Anthropic({ maxRetries: 4 });
  const modelId = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const format = zodOutputFormat(Proposal);
  const usage = emptyUsage();
  let previousYaml: string | undefined;
  let previousProblems: string[] | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // The format goes out without its parser, so the stop reason is read before the text is parsed: an answer cut
    // off in the middle of a string is a cut-off, not a broken answer worth a second attempt, and its tokens are
    // counted either way.
    const response = await client.messages
      .stream({
        model: modelId,
        max_tokens: maxTokens,
        output_config: { effort: "high", format: { type: format.type, schema: format.schema } },
        system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt(intentId, intent, model, previousProblems, previousYaml) }]
      })
      .finalMessage();
    addUsage(usage, response.usage);
    if (response.stop_reason === "refusal") {
      throw new Error(
        `Claude declined the request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ""}`
      );
    }
    if (response.stop_reason === "max_tokens") throw new ProposeCutOffError(maxTokens, attempt, usage);
    const text = response.content.flatMap(block => (block.type === "text" ? [block.text] : []))[0];
    if (text === undefined) throw new Error("Claude returned no structured proposal");
    let proposal: z.infer<typeof Proposal>;
    try {
      proposal = format.parse(text);
    } catch (error) {
      // The answer was not the JSON the format asks for (a broken escape): one more attempt
      if (!isParseFailure(error)) throw error;
      const problem = `the answer was not valid structured output: ${error instanceof Error ? error.message : String(error)}`;
      options.onAttempt?.(attempt, "", [problem]);
      if (attempt === MAX_ATTEMPTS) throw new ProposeInvalidError(problem, MAX_ATTEMPTS, [problem], usage);
      previousProblems = [problem];
      previousYaml = previousYaml ?? "";
      continue;
    }
    if (proposal.diff_yaml === null) {
      const reasons = proposal.not_delivered.length ? proposal.not_delivered : [proposal.summary];
      throw new ProposeDeclinedError(reasons, attempt, usage);
    }

    const yaml = proposal.diff_yaml.trim() + "\n";
    const { diff, problems } = validateCandidate(model, yaml);
    options.onAttempt?.(attempt, yaml, problems);
    if (diff && problems.length === 0) {
      if (!diff.summary) diff.summary = proposal.summary;
      return { diff, yaml: toYaml(diff), attempts: attempt, usage, notDelivered: proposal.not_delivered };
    }
    previousYaml = yaml;
    previousProblems = problems;
  }
  throw new ProposeInvalidError(
    `the proposal was still invalid after ${MAX_ATTEMPTS} attempts:\n  ${previousProblems!.join("\n  ")}`,
    MAX_ATTEMPTS,
    previousProblems!,
    usage
  );
}
