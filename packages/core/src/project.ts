/**
 * The project layer: `.osl/` on disk. Reads and writes the config, the model,
 * the lock with its revision history, intents and generated files.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { mergeJson, mergeRegions, type Backend, type GeneratedFile } from "./backend.js";
import { fromYaml, hashValue, prettyJson, toYaml } from "./canonical.js";
import { applyDiff, Diff, type Renames } from "./diff.js";
import { compile, type IR } from "./ir.js";
import { Model, loadModel, type Model as ModelType } from "./model.js";

export const OSL_DIR = ".osl";

export const ProjectConfig = z
  .object({
    osl: z.literal("1.0"),
    backend: z.string().min(1),
    /** Directory for backend-owned output, relative to the project root */
    generated_dir: z.string().default("generated"),
    /** Backend-specific switches, read by the backend. drizzle-next: { tailwind, shadcn: boolean; appearance: system | light | dark } */
    backend_options: z.record(z.unknown()).default({}),
    /** Policies checked when a diff is proposed or applied */
    policies: z
      .object({
        max_ops_per_intent: z.number().int().positive().optional(),
        forbid_remove_entity: z.boolean().optional(),
        forbid_remove_field: z.boolean().optional()
      })
      .strict()
      .default({})
  })
  .strict();
export type ProjectConfig = z.infer<typeof ProjectConfig>;

export const Intent = z
  .object({
    osl: z.literal("1.0"),
    title: z.string().min(1),
    /** The ask in prose */
    ask: z.string().min(1),
    /** Acceptance criteria in prose; `osl propose` turns them into scenarios */
    acceptance: z.array(z.string()).optional()
  })
  .strict();
export type Intent = z.infer<typeof Intent>;

export interface Revision {
  rev: number;
  intent: string;
  intentHash: string | null;
  diffHash: string;
  summary?: string;
  renames: Renames;
  modelHash: string;
  irHash: string;
  ir: IR;
}

export interface Lock {
  osl: "1.0";
  modelHash: string;
  irHash: string;
  revisions: Revision[];
}

export interface Project {
  root: string;
  oslDir: string;
  config: ProjectConfig;
  model: ModelType;
  lock: Lock;
  ir: IR;
}

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

const paths = (root: string) => {
  const oslDir = path.join(root, OSL_DIR);
  return {
    oslDir,
    config: path.join(oslDir, "config.yaml"),
    model: path.join(oslDir, "model.yaml"),
    lock: path.join(oslDir, "model.lock.json"),
    intents: path.join(oslDir, "intents"),
    manifest: path.join(oslDir, "generated.json")
  };
};

export function findProjectRoot(start: string): string | null {
  let dir = path.resolve(start);
  while (true) {
    if (existsSync(path.join(dir, OSL_DIR, "config.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function initProject(
  root: string,
  options: { name: string; backend: string; description?: string; backendOptions?: Record<string, unknown> }
): Promise<Project> {
  const p = paths(root);
  if (existsSync(p.config)) throw new ProjectError(`${p.config} already exists`);
  await mkdir(p.intents, { recursive: true });
  const config: ProjectConfig = ProjectConfig.parse({
    osl: "1.0",
    backend: options.backend,
    backend_options: options.backendOptions ?? {}
  });
  const model = Model.parse({ osl: "1.0", name: options.name, description: options.description, entities: {} });
  const ir = compile(model);
  const lock: Lock = { osl: "1.0", modelHash: hashValue(model), irHash: ir.hash, revisions: [] };
  await writeFile(p.config, toYaml(config));
  await writeModel(root, model);
  await writeFile(p.lock, prettyJson(lock));
  await writeFile(path.join(p.intents, ".gitkeep"), "");
  return { root, oslDir: p.oslDir, config, model, lock, ir };
}

async function writeModel(root: string, model: ModelType): Promise<void> {
  const header = "# Written by osl apply. Do not edit by hand: change it with an intent and osl apply.\n";
  await writeFile(paths(root).model, header + toYaml(model));
}

export async function loadProject(root: string): Promise<Project> {
  const p = paths(root);
  if (!existsSync(p.config))
    throw new ProjectError(`no OSL project at ${root} (missing ${OSL_DIR}/config.yaml); run osl init`);
  const config = ProjectConfig.parse(fromYaml(await readFile(p.config, "utf8")));
  const model = loadModel(fromYaml(await readFile(p.model, "utf8")));
  const lock = JSON.parse(await readFile(p.lock, "utf8")) as Lock;
  const modelHash = hashValue(model);
  if (lock.modelHash !== modelHash)
    throw new ProjectError(
      `${OSL_DIR}/model.yaml was edited by hand (hash ${modelHash} does not match the lock ${lock.modelHash}); revert it or express the change as an intent`
    );
  const ir = compile(model);
  return { root, oslDir: p.oslDir, config, model, lock, ir };
}

export interface IntentFolder {
  id: string;
  dir: string;
  intent: Intent | null;
  diff: Diff | null;
  intentHash: string | null;
  diffHash: string | null;
}

export async function readIntent(root: string, id: string): Promise<IntentFolder> {
  const dir = path.join(paths(root).intents, id);
  if (!existsSync(dir)) throw new ProjectError(`intent ${id} not found at ${dir}`);
  const intentPath = path.join(dir, "intent.yaml");
  const diffPath = path.join(dir, "diff.yaml");
  const intentRaw = existsSync(intentPath) ? fromYaml(await readFile(intentPath, "utf8")) : null;
  const diffRaw = existsSync(diffPath) ? fromYaml(await readFile(diffPath, "utf8")) : null;
  const intent = intentRaw ? Intent.parse(intentRaw) : null;
  const diff = diffRaw ? Diff.parse(diffRaw) : null;
  return {
    id,
    dir,
    intent,
    diff,
    intentHash: intent ? hashValue(intent) : null,
    diffHash: diff ? hashValue(diff) : null
  };
}

export async function listIntents(root: string): Promise<string[]> {
  const dir = paths(root).intents;
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  const out: string[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if ((await stat(path.join(dir, name))).isDirectory()) out.push(name);
  }
  return out.sort();
}

export async function createIntent(root: string, id: string, intent: Intent): Promise<string> {
  const dir = path.join(paths(root).intents, id);
  if (existsSync(dir)) throw new ProjectError(`intent ${id} already exists`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "intent.yaml"), toYaml(intent));
  return dir;
}

export async function writeDiff(root: string, id: string, diff: Diff): Promise<string> {
  const dir = path.join(paths(root).intents, id);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "diff.yaml");
  await writeFile(file, toYaml(diff));
  return file;
}

export interface ApplyOutcome {
  status: "applied" | "noop";
  revision: Revision;
  model: ModelType;
  ir: IR;
}

export function checkPolicies(config: ProjectConfig, diff: Diff): string[] {
  const violations: string[] = [];
  const { policies } = config;
  if (policies.max_ops_per_intent && diff.ops.length > policies.max_ops_per_intent)
    violations.push(`intent has ${diff.ops.length} ops; policy allows ${policies.max_ops_per_intent}`);
  if (policies.forbid_remove_entity && diff.ops.some(op => op.op === "remove_entity"))
    violations.push("policy forbids remove_entity");
  if (policies.forbid_remove_field && diff.ops.some(op => op.op === "remove_field"))
    violations.push("policy forbids remove_field");
  return violations;
}

/** Apply an intent's diff to the model, write the model and the lock. Idempotent per intent. */
export async function applyIntent(root: string, id: string): Promise<ApplyOutcome> {
  const project = await loadProject(root);
  const folder = await readIntent(root, id);
  if (!folder.diff) throw new ProjectError(`intent ${id} has no diff.yaml; write one or run osl propose ${id}`);

  const existing = project.lock.revisions.find(r => r.intent === id);
  if (existing) {
    if (existing.diffHash === folder.diffHash)
      return { status: "noop", revision: existing, model: project.model, ir: project.ir };
    throw new ProjectError(
      `intent ${id} was already applied as revision ${existing.rev} with a different diff; create a new intent for further changes`
    );
  }

  const violations = checkPolicies(project.config, folder.diff);
  if (violations.length > 0) throw new ProjectError(`policy violations for ${id}:\n  ${violations.join("\n  ")}`);

  const { model, renames } = applyDiff(project.model, folder.diff);
  const ir = compile(model);
  const revision: Revision = {
    rev: project.lock.revisions.length + 1,
    intent: id,
    intentHash: folder.intentHash,
    diffHash: folder.diffHash!,
    summary: folder.diff.summary,
    renames,
    modelHash: hashValue(model),
    irHash: ir.hash,
    ir
  };
  const lock: Lock = {
    osl: "1.0",
    modelHash: revision.modelHash,
    irHash: ir.hash,
    revisions: [...project.lock.revisions, revision]
  };
  await writeModel(root, model);
  await writeFile(paths(root).lock, prettyJson(lock));
  return { status: "applied", revision, model, ir };
}

export interface WriteReport {
  written: string[];
  skipped: string[];
  merged: string[];
  removed: string[];
}

/** Write a backend's files. Generated files no longer produced are removed. */
export async function writeGeneratedFiles(root: string, files: GeneratedFile[]): Promise<WriteReport> {
  const p = paths(root);
  const report: WriteReport = { written: [], skipped: [], merged: [], removed: [] };
  const previous: string[] = existsSync(p.manifest)
    ? (JSON.parse(await readFile(p.manifest, "utf8")) as { files: string[] }).files
    : [];
  const produced = new Set<string>();

  for (const file of files) {
    const target = path.join(root, file.path);
    const mode = file.mode ?? "generated";
    await mkdir(path.dirname(target), { recursive: true });
    if (mode === "generated") produced.add(file.path);

    if (mode === "scaffold" && existsSync(target)) {
      report.skipped.push(file.path);
      continue;
    }
    if (mode === "merge" && existsSync(target)) {
      const existing = await readFile(target, "utf8");
      const merged = JSON.stringify(mergeJson(JSON.parse(existing), JSON.parse(file.content)), null, 2) + "\n";
      if (merged !== existing) {
        await writeFile(target, merged);
        report.merged.push(file.path);
      } else report.skipped.push(file.path);
      continue;
    }
    if (mode === "regions" && existsSync(target)) {
      const existing = await readFile(target, "utf8");
      const merged = mergeRegions(existing, file.content);
      if (merged !== existing) {
        await writeFile(target, merged);
        report.merged.push(file.path);
      } else report.skipped.push(file.path);
      continue;
    }
    const current = existsSync(target) ? await readFile(target, "utf8") : null;
    if (current !== file.content) {
      await writeFile(target, file.content, { mode: file.executable ? 0o755 : 0o644 });
      report.written.push(file.path);
    } else report.skipped.push(file.path);
  }

  for (const stale of previous) {
    if (!produced.has(stale) && existsSync(path.join(root, stale))) {
      await rm(path.join(root, stale));
      report.removed.push(stale);
    }
  }
  await writeFile(p.manifest, prettyJson({ files: [...produced].sort() }));
  return report;
}

export async function generateProject(
  root: string,
  backend: Backend
): Promise<{ files: GeneratedFile[]; report: WriteReport }> {
  const project = await loadProject(root);
  const files = backend.generate({ ir: project.ir, revisions: project.lock.revisions, config: project.config });
  const report = await writeGeneratedFiles(root, files);
  return { files, report };
}

export function generatedDir(project: Project): string {
  return path.join(project.root, project.config.generated_dir);
}
