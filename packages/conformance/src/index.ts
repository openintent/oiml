/**
 * Conformance harness: proves a backend against a fixture.
 *
 * 1. Build a project from the fixture's intents and generate it.
 * 2. Compare every generated file with the committed snapshot.
 * 3. Install, typecheck, migrate a throwaway database, check drift,
 *    start the app and run the contract tests derived from the examples.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import {
  applyIntent,
  checkDrift,
  formatDrift,
  fromYaml,
  generateProject,
  initProject,
  listIntents,
  loadProject,
  provisionAppLogin,
  runMigrations,
  type Backend,
  type Cmd,
  type GeneratedFile,
  type ProjectConfig
} from "@osl/core";
import { drizzleNextBackend } from "@osl/backend-drizzle-next";
import { ginPgxBackend } from "@osl/backend-gin-pgx";
import { honoTrpcViteBackend } from "@osl/backend-hono-trpc-vite";
import { runWalks, WALKS, type WalkName } from "./walks.js";

export { runWalks, WALKS, type WalkName, type WalkContext, type WalkResult } from "./walks.js";

export const BACKENDS: Record<string, Backend> = {
  [drizzleNextBackend.name]: drizzleNextBackend,
  [ginPgxBackend.name]: ginPgxBackend,
  [honoTrpcViteBackend.name]: honoTrpcViteBackend
};

export interface Fixture {
  name: string;
  description?: string;
  /** Backends this fixture is expected to pass on */
  backends: string[];
  dir: string;
  /** The seed of the fuzz walk's generator (`walks: { seed }` in fixture.yaml), so a failure replays */
  seed?: number;
}

export interface StepResult {
  step: string;
  ok: boolean;
  detail?: string;
  ms: number;
}

export interface FixtureResult {
  fixture: string;
  backend: string;
  ok: boolean;
  steps: StepResult[];
  dir: string;
}

export interface RunOptions {
  /** Rewrite the snapshot instead of comparing */
  update?: boolean;
  /** Skip install, typecheck, database and tests */
  snapshotOnly?: boolean;
  /** Skip the snapshot comparison (for fixtures built on the fly, which have no committed snapshot) */
  skipSnapshot?: boolean;
  /** Admin connection string; a throwaway database is created on this server */
  databaseUrl?: string;
  /** Keep the temp directory for inspection */
  keep?: boolean;
  /**
   * Install and run the project with this package manager instead of the backend's default (pnpm).
   * The snapshots are written for the default, so the snapshot step is skipped for any other.
   */
  packageManager?: string;
  /**
   * Runs once the project is installed and before it is checked, with the project directory; what it returns is
   * the step's detail. The eval runner writes the action handlers here.
   */
  afterInstall?: (dir: string, backendName: string) => Promise<string | void>;
  /** Run the conformance walks after the tests (default true); `false` skips them */
  walks?: boolean;
  /** Run only these walks; every walk when empty */
  walkSet?: WalkName[];
  /** Skip the scenario tests and run the walks alone */
  walksOnly?: boolean;
  /** The fuzz walk's seed, over the fixture's own */
  seed?: number;
  log?: (line: string) => void;
}

export async function loadFixture(dir: string): Promise<Fixture> {
  const raw = fromYaml<{
    name: string;
    description?: string;
    backend?: string;
    backends?: string[];
    walks?: { seed?: number };
  }>(await readFile(path.join(dir, "fixture.yaml"), "utf8"));
  const backends = raw.backends ?? (raw.backend ? [raw.backend] : []);
  if (backends.length === 0) throw new Error(`${dir}/fixture.yaml names no backends`);
  return { name: raw.name, description: raw.description, backends, dir, seed: raw.walks?.seed };
}

export async function listFixtures(root: string): Promise<Fixture[]> {
  const names = (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name);
  const fixtures: Fixture[] = [];
  for (const name of names.sort()) {
    const dir = path.join(root, name);
    if (existsSync(path.join(dir, "fixture.yaml"))) fixtures.push(await loadFixture(dir));
  }
  return fixtures;
}

export async function runFixture(
  fixture: Fixture,
  backendName: string,
  options: RunOptions = {}
): Promise<FixtureResult> {
  const log = options.log ?? (() => {});
  const backend = BACKENDS[backendName];
  if (!backend) throw new Error(`unknown backend ${backendName}; known: ${Object.keys(BACKENDS).join(", ")}`);
  const steps: StepResult[] = [];
  const dir = await mkdtemp(path.join(tmpdir(), `osl-${fixture.name}-`));
  const result: FixtureResult = { fixture: fixture.name, backend: backend.name, ok: true, steps, dir };

  const step = async (name: string, fn: () => Promise<string | void>): Promise<boolean> => {
    const started = Date.now();
    try {
      const detail = (await fn()) ?? undefined;
      steps.push({ step: name, ok: true, detail, ms: Date.now() - started });
      log(`  ok   ${name}${detail ? ` (${detail})` : ""}`);
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      steps.push({ step: name, ok: false, detail, ms: Date.now() - started });
      log(`  FAIL ${name}\n${indent(detail)}`);
      result.ok = false;
      return false;
    }
  };

  let files: GeneratedFile[] = [];
  let config: ProjectConfig | null = null;
  const generated = await step("generate", async () => {
    const backendOptions = options.packageManager ? { package_manager: options.packageManager } : {};
    await initProject(dir, {
      name: fixture.name,
      backend: backend.name,
      description: fixture.description,
      backendOptions
    });
    await cp(path.join(fixture.dir, "intents"), path.join(dir, ".osl/intents"), { recursive: true });
    const ids = await listIntents(dir);
    for (const id of ids) await applyIntent(dir, id);
    const out = await generateProject(dir, backend);
    files = out.files;
    config = (await loadProject(dir)).config;
    // A fixture may ship the user-owned code its scenarios depend on (action handlers), per backend
    const overlay = path.join(fixture.dir, "overlay", backend.name);
    let overlaid = 0;
    if (existsSync(overlay)) {
      await cp(overlay, dir, { recursive: true });
      overlaid = (await readTree(overlay)).size;
    }
    return `${ids.length} intents, ${files.length} files${overlaid ? `, ${overlaid} overlay files` : ""}`;
  });
  if (!generated) return finish(result, options);

  const offDefault = options.packageManager && options.packageManager !== "pnpm";
  await step("snapshot", async () => {
    if (options.skipSnapshot) return "skipped";
    if (offDefault) return `skipped: snapshots are written for pnpm, not ${options.packageManager}`;
    const snapshotDir = path.join(fixture.dir, "expected", backend.name);
    if (options.update) {
      await rm(snapshotDir, { recursive: true, force: true });
      for (const file of files) {
        const target = path.join(snapshotDir, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.content);
      }
      return `wrote ${files.length} files`;
    }
    if (!existsSync(snapshotDir)) throw new Error(`no snapshot at ${snapshotDir}; run with --update to create it`);
    const expected = await readTree(snapshotDir);
    const problems: string[] = [];
    for (const file of files) {
      const want = expected.get(file.path);
      if (want === undefined) problems.push(`new file ${file.path}`);
      else if (want !== file.content) problems.push(`changed ${file.path}`);
      expected.delete(file.path);
    }
    for (const stale of expected.keys()) problems.push(`no longer generated ${stale}`);
    if (problems.length)
      throw new Error(`snapshot differs:\n${problems.join("\n")}\nRun with --update if the change is intended.`);
    return `${files.length} files match`;
  });

  if (options.snapshotOnly) return finish(result, options);

  const runtime = backend.runtime(config!);
  const installed = await step("install", async () => {
    for (const cmd of runtime.install) await exec(cmd, dir);
  });
  if (!installed) return finish(result, options);

  if (options.afterInstall) {
    const prepared = await step("implement", () => options.afterInstall!(dir, backend.name));
    if (!prepared) return finish(result, options);
  }

  await step("check", async () => {
    for (const cmd of runtime.check) await exec(cmd, dir);
  });

  const adminUrl = options.databaseUrl ?? process.env.OSL_TEST_DATABASE_URL;
  if (!adminUrl) {
    steps.push({
      step: "database",
      ok: false,
      detail: "set OSL_TEST_DATABASE_URL to a PostgreSQL admin connection string",
      ms: 0
    });
    result.ok = false;
    return finish(result, options);
  }
  const dbName = `osl_${fixture.name}_${Date.now().toString(36)}`.replace(/[^a-z0-9_]/g, "_");
  // isolation: database is proven the way it is deployed: the database belongs to a role that is no superuser
  // (migrations, the worker and the walks' own reads go through it), and the app serves as a third role, a login
  // that is a member of the model's app role. Both are made for this run and dropped with the database; their
  // passwords are random and live in this process's memory only.
  const isolation = (await loadProject(dir)).ir.auth?.tenancy?.isolation;
  const ownerRole = `${dbName}_owner`;
  const webRole = `${dbName}_web`;
  const ownerPassword = randomBytes(18).toString("hex");
  const webPassword = randomBytes(18).toString("hex");
  const databaseUrl = isolation
    ? withUser(withDatabase(adminUrl, dbName), ownerRole, ownerPassword)
    : withDatabase(adminUrl, dbName);
  const appDatabaseUrl = isolation ? withUser(withDatabase(adminUrl, dbName), webRole, webPassword) : undefined;
  let server: ChildProcess | null = null;
  try {
    const created = await step("database", async () => {
      if (isolation) {
        await adminQuery(
          adminUrl,
          `CREATE ROLE "${ownerRole}" LOGIN PASSWORD '${ownerPassword}' NOSUPERUSER NOBYPASSRLS CREATEROLE`
        );
        await adminQuery(adminUrl, `CREATE DATABASE "${dbName}" OWNER "${ownerRole}"`);
        return `${dbName}, owned by ${ownerRole} (no superuser)`;
      }
      await adminQuery(adminUrl, `CREATE DATABASE "${dbName}"`);
      return dbName;
    });
    if (!created) return finish(result, options);

    await step("migrate", async () => {
      const migrated = await runMigrations(databaseUrl, path.join(dir, runtime.migrationsDir("generated")));
      if (!isolation) return `${migrated.applied.length} applied`;
      // The app role exists now, without a login; an administrator gives this run its own login as a member of it
      const login = await provisionAppLogin(adminUrl, isolation.appRole, appDatabaseUrl!);
      return `${migrated.applied.length} applied; ${login}`;
    });

    await step("drift", async () => {
      const project = await loadProject(dir);
      const drift = await checkDrift(databaseUrl, project.ir, { ignoreTables: runtime.ignoredTables });
      if (drift.length) throw new Error(formatDrift(drift));
    });

    const port = await freePort();
    const started = await step("start", async () => {
      const cmd = runtime.serve(port);
      server = spawn(cmd.command, cmd.args, {
        cwd: dir,
        env: {
          ...process.env,
          ...cmd.env,
          DATABASE_URL: databaseUrl,
          ...(appDatabaseUrl ? { DATABASE_APP_URL: appDatabaseUrl } : {}),
          OSL_SESSION_SECRET: "conformance-secret",
          OSL_TEST_HOOKS: "1",
          PORT: String(port)
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      server.stdout?.on("data", d => (output += d));
      server.stderr?.on("data", d => (output += d));
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        if (server.exitCode !== null) throw new Error(`server exited early:\n${output}`);
        try {
          await fetch(`http://localhost:${port}${runtime.readyPath}`);
          return `port ${port}`;
        } catch {
          await sleep(500);
        }
      }
      throw new Error(`server did not answer within 90s:\n${output}`);
    });
    if (!started) return finish(result, options);

    if (!options.walksOnly)
      await step("tests", async () => {
        // The tests reach the database too: actors that carry a role are provisioned there after registering
        const cmd = runtime.test(`http://localhost:${port}`);
        const out = await exec({ ...cmd, env: { ...cmd.env, DATABASE_URL: databaseUrl } }, dir);
        return out.match(/Tests\s+(.+)/)?.[1]?.trim() ?? out.match(/^(ok|PASS).*$/m)?.[0]?.trim();
      });

    if (options.walks !== false) {
      // The walks: what the IR predicts for every operation and caller, checked against the running app
      const which = new Set<string>(options.walkSet?.length ? options.walkSet : WALKS);
      let walkResults: Awaited<ReturnType<typeof runWalks>> = [];
      const ran = await step("walks", async () => {
        const project = await loadProject(dir);
        walkResults = await runWalks(
          {
            ir: project.ir,
            backend: backend.name,
            baseUrl: `http://localhost:${port}`,
            databaseUrl,
            projectDir: dir,
            seed: options.seed ?? fixture.seed ?? 1,
            log
          },
          which
        );
        return `${walkResults.length} walks`;
      });
      if (ran)
        for (const w of walkResults) {
          steps.push({ step: `walk:${w.name}`, ok: w.ok, detail: w.detail, ms: w.ms });
          if (w.ok) log(`  ok   walk:${w.name} (${w.detail})`);
          else {
            log(`  FAIL walk:${w.name}\n${indent(w.detail)}`);
            result.ok = false;
          }
        }
    }
  } finally {
    if (server) {
      (server as ChildProcess).kill("SIGTERM");
      await sleep(300);
      if ((server as ChildProcess).exitCode === null) (server as ChildProcess).kill("SIGKILL");
    }
    try {
      await adminQuery(adminUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      if (isolation) {
        await adminQuery(adminUrl, `DROP ROLE IF EXISTS "${webRole}"`);
        await adminQuery(adminUrl, `DROP ROLE IF EXISTS "${ownerRole}"`);
      }
    } catch (error) {
      log(`  warn could not drop ${dbName}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return finish(result, options);
}

async function finish(result: FixtureResult, options: RunOptions): Promise<FixtureResult> {
  if (!options.keep && result.ok) await rm(result.dir, { recursive: true, force: true });
  return result;
}

async function readTree(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.set(path.relative(root, full).split(path.sep).join("/"), await readFile(full, "utf8"));
    }
  };
  await walk(root);
  return out;
}

function exec(cmd: Cmd, cwd: string): Promise<string> {
  const { command, args, env = {} } = cmd;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", d => (output += d));
    child.stderr.on("data", d => (output += d));
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(output);
      else reject(new Error(`${path.basename(command)} ${args.join(" ")} exited ${code}:\n${tail(output, 60)}`));
    });
  });
}

async function adminQuery(url: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function withUser(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function tail(text: string, lines: number): string {
  return text.split("\n").slice(-lines).join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map(l => `       ${l}`)
    .join("\n");
}

export function formatResult(result: FixtureResult): string {
  const lines = [`${result.ok ? "PASS" : "FAIL"} ${result.fixture} on ${result.backend}`];
  for (const s of result.steps)
    lines.push(
      `  ${s.ok ? "ok  " : "FAIL"} ${s.step.padEnd(14)} ${String(s.ms).padStart(6)}ms${s.detail && s.ok ? `  ${s.detail}` : ""}`
    );
  if (!result.ok) lines.push(`  kept at ${result.dir}`);
  return lines.join("\n");
}
