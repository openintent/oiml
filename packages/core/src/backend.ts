/**
 * The contract between the compiler and a backend. A backend is a pure function
 * from IR (plus the revision history, for migrations) to a set of files.
 */
import type { IR } from "./ir.js";
import type { ProjectConfig, Revision } from "./project.js";

export interface GeneratedFile {
  /** Path relative to the project root, with forward slashes */
  path: string;
  content: string;
  /**
   * generated: owned by the backend, rewritten on every generate and removed when no longer produced.
   * scaffold: written once when absent, then left to the user.
   * regions: the user owns the file; only the marked regions are rewritten.
   * merge: a JSON file the user owns; keys the backend declares are added when missing, never changed (package.json).
   */
  mode?: "generated" | "scaffold" | "regions" | "merge";
  executable?: boolean;
}

export interface GenerateInput {
  ir: IR;
  /** Every applied revision in order, each with its IR, for migrations */
  revisions: Revision[];
  config: ProjectConfig;
}

export interface Cmd {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** How to run a generated project. Commands run with the project root as cwd. */
export interface BackendRuntime {
  /** Install dependencies, in order */
  install: Cmd[];
  /** Compile or typecheck without running */
  check: Cmd[];
  /** Start the app on a port; DATABASE_URL and OSL_SESSION_SECRET are set in the environment */
  serve(port: number): Cmd;
  /** Run the contract tests against a running app */
  test(baseUrl: string): Cmd;
  /** Replay the model's seed steps against a running app */
  seed(baseUrl: string): Cmd;
  /** Tables other tooling owns in the database (job queues), which the drift check leaves alone; SQL LIKE patterns */
  ignoredTables?: string[];
  /** A path that answers once the server is up */
  readyPath: string;
  /** Where the backend writes migration SQL, relative to the project root */
  migrationsDir(generatedDir: string): string;
}

export interface Backend {
  name: string;
  version: string;
  /** Model constructs this backend generates; the rest go to the extension step */
  generates: string[];
  generate(input: GenerateInput): GeneratedFile[];
  /** How to run a project generated with this config (its backend_options pick the package manager, say) */
  runtime(config: ProjectConfig): BackendRuntime;
}

/** Region markers use the host file's comment style: `//` for code, `#` for env and YAML. */
export const REGION_BEGIN = (name: string, comment = "//") => `${comment} osl:begin ${name}`;
export const REGION_END = (name: string, comment = "//") => `${comment} osl:end ${name}`;

/** Merge the marked regions of `next` into `existing`; everything else in `existing` is kept. */
export function mergeRegions(existing: string, next: string): string {
  const regionPattern = /(\/\/|#) osl:begin ([a-z0-9_-]+)\n([\s\S]*?)\1 osl:end \2/g;
  let merged = existing;
  let extra = "";
  for (const match of next.matchAll(regionPattern)) {
    const [block, comment, name] = match;
    const escaped = comment.replace(/\//g, "\\/");
    const target = new RegExp(`${escaped} osl:begin ${name}\\n[\\s\\S]*?${escaped} osl:end ${name}`);
    if (target.test(merged)) merged = merged.replace(target, () => block);
    else extra += `\n${block}\n`;
  }
  return extra ? merged.replace(/\s*$/, "\n") + extra : merged;
}

/** Add the keys of `incoming` that `existing` lacks, recursively through plain objects; existing values are kept. */
export function mergeJson(existing: unknown, incoming: unknown): unknown {
  if (!isPlainObject(existing) || !isPlainObject(incoming)) return existing;
  const out: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in out)) out[key] = value;
    else if (isPlainObject(out[key]) && isPlainObject(value)) out[key] = mergeJson(out[key], value);
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
