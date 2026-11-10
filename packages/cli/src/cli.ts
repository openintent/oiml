#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { Command, Option } from "commander";
import {
  ProjectError,
  applyIntent,
  checkDrift,
  createIntent,
  findProjectRoot,
  formatDrift,
  generateProject,
  initProject,
  listIntents,
  loadProject,
  pendingMigrations,
  readIntent,
  provisionAppLogin,
  runMigrations,
  toYaml,
  userActions,
  validateModel,
  writeDiff,
  type GeneratedFile
} from "@osl/core";
import { BACKENDS, backendNamed } from "./backends.js";
import { loadDotEnv, requireDatabaseUrl } from "./env.js";
import { implementActions } from "./implement.js";
import { DEFAULT_MODEL, ProposeDeclinedError, propose } from "./propose.js";
import { startMcp } from "./mcp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(path.join(here, "../package.json"), "utf8")) as { version: string };

const program = new Command();
program
  .name("osl")
  .description("Open Schema Language: compile a declared application model into working code")
  .version(pkg.version);

const ok = (msg: string) => console.log(chalk.green("✓"), msg);
const info = (msg: string) => console.log(chalk.gray("·"), msg);
const warn = (msg: string) => console.log(chalk.yellow("!"), msg);

function projectRoot(): string {
  const root = findProjectRoot(process.cwd());
  if (!root) throw new ProjectError("not inside an OSL project (no .osl/config.yaml found); run osl init");
  return root;
}

program
  .command("init")
  .description("Create .osl/ in the current directory")
  .option(
    "-n, --name <name>",
    "project name (lowercase, hyphens)",
    path
      .basename(process.cwd())
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
  )
  .option("-b, --backend <backend>", `backend: ${Object.keys(BACKENDS).join(", ")}`, "drizzle-next")
  .option("-d, --description <text>", "one line on the project")
  .option("--no-tailwind", "drizzle-next only: scaffold the app without Tailwind CSS (implies --no-shadcn)")
  .option("--no-shadcn", "drizzle-next only: scaffold the app without shadcn/ui components")
  .addOption(
    new Option("--appearance <mode>", "TypeScript backends: color scheme of the scaffolded app")
      .choices(["system", "light", "dark"])
      .default("system")
  )
  .addOption(
    new Option("--package-manager <pm>", "TypeScript backends: what installs and runs the generated project")
      .choices(["pnpm", "bun", "npm"])
      .default("pnpm")
  )
  .action(
    async (options: {
      name: string;
      backend: string;
      description?: string;
      tailwind: boolean;
      shadcn: boolean;
      appearance: "system" | "light" | "dark";
      packageManager: "pnpm" | "bun" | "npm";
    }) => {
      backendNamed(options.backend);
      const backendOptions: Record<string, boolean | string> = {};
      if (options.tailwind === false) backendOptions.tailwind = false;
      if (options.shadcn === false || options.tailwind === false) backendOptions.shadcn = false;
      if (options.appearance !== "system") backendOptions.appearance = options.appearance;
      if (options.packageManager !== "pnpm") backendOptions.package_manager = options.packageManager;
      const project = await initProject(process.cwd(), { ...options, backendOptions });
      ok(
        `created ${path.relative(process.cwd(), project.oslDir) || ".osl"} for ${project.model.name} with backend ${options.backend}`
      );
      info(
        "next: osl intent FEAT-1 --title ... --ask ..., then osl propose FEAT-1 (or write diff.yaml), osl apply, osl generate"
      );
    }
  );

program
  .command("intent <id>")
  .description("Create .osl/intents/<id>/intent.yaml from a title and an ask")
  .requiredOption("-t, --title <title>", "short title")
  .requiredOption("-a, --ask <ask>", "the request in prose")
  .option("-c, --acceptance <criteria...>", "acceptance criteria, one per argument")
  .action(async (id: string, options: { title: string; ask: string; acceptance?: string[] }) => {
    const dir = await createIntent(projectRoot(), id, {
      osl: "1.0",
      title: options.title,
      ask: options.ask,
      acceptance: options.acceptance
    });
    ok(`created ${path.relative(process.cwd(), dir)}/intent.yaml`);
    info(`next: osl propose ${id}, or write ${id}/diff.yaml by hand, then osl apply ${id}`);
  });

program
  .command("propose <id>")
  .description("Ask Claude for a model diff that delivers the intent, validated against the current model")
  .option("-m, --model <model>", "Claude model id", DEFAULT_MODEL)
  .option("--print", "print the diff instead of writing diff.yaml")
  .action(async (id: string, options: { model: string; print?: boolean }) => {
    const root = projectRoot();
    const project = await loadProject(root);
    const folder = await readIntent(root, id);
    if (!folder.intent) throw new ProjectError(`${id} has no intent.yaml; run osl intent ${id} first`);
    if (folder.diff && !options.print)
      throw new ProjectError(`${id} already has a diff.yaml; delete it to propose again`);
    info(`asking ${options.model} for a diff for ${id}: ${folder.intent.title}`);
    let result;
    try {
      result = await propose(id, folder.intent, project.model, {
        model: options.model,
        onAttempt: (attempt, _yaml, problems) => {
          if (problems.length)
            warn(`attempt ${attempt} rejected: ${problems.length} problem(s), retrying with feedback`);
        }
      });
    } catch (error) {
      if (error instanceof ProposeDeclinedError) {
        warn(`${options.model} found nothing in ${id} that the model can express:`);
        for (const reason of error.reasons) warn(`  - ${reason}`);
        info("rephrase the intent, or write diff.yaml by hand");
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    for (const line of result.notDelivered) warn(`not delivered: ${line}`);
    if (options.print) {
      console.log(result.yaml);
      return;
    }
    const file = await writeDiff(root, id, result.diff);
    ok(
      `wrote ${path.relative(process.cwd(), file)} (${result.diff.ops.length} ops, ${result.attempts} attempt${result.attempts > 1 ? "s" : ""})`
    );
    info(`review it, then osl apply ${id}`);
  });

program
  .command("apply [ids...]")
  .description("Apply intents' diff.yaml files to the model in order (default: every intent not yet applied)")
  .action(async (ids: string[]) => {
    const root = projectRoot();
    const project = await loadProject(root);
    const applied = new Set(project.lock.revisions.map(r => r.intent));
    const targets = ids.length ? ids : (await listIntents(root)).filter(id => !applied.has(id));
    if (targets.length === 0) {
      info("nothing to apply");
      return;
    }
    for (const id of targets) {
      const outcome = await applyIntent(root, id);
      if (outcome.status === "noop") info(`${id} already applied as revision ${outcome.revision.rev}`);
      else
        ok(
          `applied ${id} as revision ${outcome.revision.rev}${outcome.revision.summary ? `: ${outcome.revision.summary}` : ""}`
        );
      // isolation: database changes what some rules allow (an owner must also be a member), leaves some entities
      // shared, and makes a count on a shared row add up every tenant's rows: say so when the intent is applied,
      // not only in the generated code
      if (outcome.status !== "noop" && outcome.model.auth?.tenancy?.isolation === "database")
        for (const d of validateModel(outcome.model))
          if (d.code === "M116" || d.code === "M119" || d.code === "M156") warn(`${d.code} ${d.path}: ${d.message}`);
    }
    info("next: osl generate");
  });

program
  .command("generate")
  .description("Run the backend and write the generated files")
  .action(async () => {
    const root = projectRoot();
    const project = await loadProject(root);
    const backend = backendNamed(project.config.backend);
    const { report } = await generateProject(root, backend);
    ok(
      `${backend.name}: ${report.written.length} written, ${report.merged.length} merged, ${report.skipped.length} unchanged, ${report.removed.length} removed`
    );
    for (const f of report.written) info(`wrote ${f}`);
    for (const f of report.merged) info(`merged regions in ${f}`);
    for (const f of report.removed) info(`removed ${f}`);
    if (!existsSync(path.join(root, "node_modules"))) {
      const install = backend.runtime(project.config).install[0];
      const shown = install ? `${install.command} ${install.args.filter(a => !a.startsWith("-")).join(" ")}` : "";
      info(`next: install dependencies${shown ? ` (${shown})` : ""}, then osl migrate`);
    }
  });

program
  .command("implement [handlers...]")
  .description(
    "Ask Claude to write the action handlers still at their stubs (or the named ones), checked with the backend's compiler"
  )
  .option("-m, --model <model>", "Claude model id", DEFAULT_MODEL)
  .option("--force", "also rewrite handlers that are no longer stubs")
  .option("--no-check", "skip the compiler check")
  .action(async (handlers: string[], options: { model: string; force?: boolean; check: boolean }) => {
    const root = projectRoot();
    const project = await loadProject(root);
    const backend = backendNamed(project.config.backend);
    if (userActions(project.ir).length === 0) {
      info("the model declares no actions, so there is nothing to implement");
      return;
    }
    info(
      `asking ${options.model} to write ${handlers.length ? handlers.join(", ") : "the handlers still at their stubs"}`
    );
    const result = await implementActions(root, backend, {
      model: options.model,
      only: handlers.length ? handlers : undefined,
      force: options.force,
      check: options.check,
      onAttempt: (handler, attempt, problems) => {
        if (problems.length) warn(`${handler}: attempt ${attempt} failed the check, retrying with its output`);
      }
    });
    for (const h of result.handlers) {
      if (h.skipped) info(`${h.path}: ${h.skipped}`);
      else if (h.ok)
        ok(`wrote ${h.path} (${h.attempts} attempt${h.attempts === 1 ? "" : "s"})${h.notes ? `: ${h.notes}` : ""}`);
      else {
        console.log(chalk.red("✗"), `${h.path} still fails the check after ${h.attempts} attempts:`);
        for (const line of h.problems) console.log(`    ${line}`);
        process.exitCode = 1;
      }
    }
    const written = result.handlers.filter(h => !h.skipped);
    if (written.length === 0) info("every handler is already implemented; pass --force or name the ones to rewrite");
    else {
      info(
        `tokens: ${(result.usage.input_tokens + result.usage.cache_read_input_tokens + result.usage.cache_creation_input_tokens).toLocaleString()} in, ${result.usage.output_tokens.toLocaleString()} out`
      );
      info("next: review the handlers, then osl verify --base-url <url> runs the contract tests against them");
    }
  });

program
  .command("migrate")
  .description("Apply pending migrations to DATABASE_URL")
  .option("-u, --url <url>", "database connection string")
  .action(async (options: { url?: string }) => {
    const root = projectRoot();
    const project = await loadProject(root);
    const url = requireDatabaseUrl(root, options.url);
    const result = await runMigrations(url, path.join(root, project.config.generated_dir, "db/migrations"));
    if (result.applied.length === 0) info(`no pending migrations (${result.skipped.length} already applied)`);
    for (const name of result.applied) ok(`applied ${name}`);
    // isolation: database: the app role gets its password from the environment, never from a generated file
    const isolation = project.ir.auth?.tenancy?.isolation;
    if (isolation) {
      if (process.env.DATABASE_APP_URL)
        ok(await provisionAppLogin(url, isolation.appRole, process.env.DATABASE_APP_URL));
      else
        info(
          `set DATABASE_APP_URL (the web process's connection, as role ${isolation.appRole}) and run osl migrate again to give the role its password`
        );
    }
  });

program
  .command("drift")
  .description("Compare the database with the model")
  .option("-u, --url <url>", "database connection string")
  .action(async (options: { url?: string }) => {
    const root = projectRoot();
    const project = await loadProject(root);
    const drift = await checkDrift(requireDatabaseUrl(root, options.url), project.ir);
    if (drift.length === 0) ok("no drift");
    else {
      console.log(formatDrift(drift));
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Model summary, revisions, pending intents and migrations")
  .action(async () => {
    const root = projectRoot();
    const project = await loadProject(root);
    console.log(
      chalk.bold(project.model.name),
      chalk.gray(
        `backend ${project.config.backend}, ${project.lock.revisions.length} revisions, ir ${project.ir.hash.slice(7, 19)}`
      )
    );
    for (const e of project.ir.entities) {
      console.log(`  ${e.name} (${e.table}): ${e.columns.map(c => c.name).join(", ")}`);
    }
    for (const r of project.ir.resources) {
      console.log(`  ${r.path}: ${r.operations.map(o => o.kind).join(", ")}`);
    }
    if (project.ir.auth) console.log(`  auth: ${project.ir.auth.identity} via ${project.ir.auth.provider}`);
    const applied = new Set(project.lock.revisions.map(r => r.intent));
    const pending = (await listIntents(root)).filter(id => !applied.has(id));
    console.log(
      pending.length ? chalk.yellow(`  pending intents: ${pending.join(", ")}`) : chalk.gray("  no pending intents")
    );
    loadDotEnv(root);
    if (process.env.DATABASE_URL) {
      try {
        const names = await pendingMigrations(
          process.env.DATABASE_URL,
          path.join(root, project.config.generated_dir, "db/migrations")
        );
        console.log(
          names.length
            ? chalk.yellow(`  pending migrations: ${names.join(", ")}`)
            : chalk.gray("  no pending migrations")
        );
      } catch (error) {
        console.log(chalk.gray(`  database unreachable: ${error instanceof Error ? error.message : error}`));
      }
    }
  });

program
  .command("ir")
  .description("Print the compiled IR as JSON")
  .action(async () => {
    const project = await loadProject(projectRoot());
    console.log(JSON.stringify(project.ir, null, 2));
  });

program
  .command("seed")
  .description("Replay the model's seed steps (examples.seed) against a running app")
  .option("--base-url <url>", "where the app answers", "http://localhost:3000")
  .action(async (options: { baseUrl: string }) => {
    const root = projectRoot();
    const project = await loadProject(root);
    const backend = backendNamed(project.config.backend);
    if (project.ir.examples.seed.length === 0) {
      warn("the model declares no seed steps (examples.seed)");
      return;
    }
    loadDotEnv(root); // actors that carry a role are provisioned in the database (DATABASE_URL) after registering
    const cmd = backend.runtime(project.config).seed(options.baseUrl);
    const result = await run(cmd.command, cmd.args, root, cmd.env);
    process.stdout.write(result.output);
    if (result.code === 0) ok(`seeded ${project.ir.examples.seed.length} steps against ${options.baseUrl}`);
    else {
      warn("seed failed");
      process.exitCode = 1;
    }
  });

program
  .command("model")
  .description("Print the current model")
  .action(async () => {
    const project = await loadProject(projectRoot());
    console.log(toYaml(project.model));
  });

program
  .command("verify")
  .description(
    "Check generated files are current, typecheck, and (with DATABASE_URL) migrations and drift; with --base-url, run the contract tests"
  )
  .option("-u, --url <url>", "database connection string")
  .option("--base-url <url>", "running app to test, e.g. http://localhost:3000")
  .action(async (options: { url?: string; baseUrl?: string }) => {
    const root = projectRoot();
    const project = await loadProject(root);
    const backend = backendNamed(project.config.backend);
    let failed = false;
    const fail = (msg: string) => {
      console.log(chalk.red("✗"), msg);
      failed = true;
    };

    const files = backend.generate({ ir: project.ir, revisions: project.lock.revisions, config: project.config });
    const stale = await staleFiles(root, files);
    if (stale.length) fail(`generated files out of date: ${stale.join(", ")} (run osl generate)`);
    else ok("generated files are current");

    const tsc = path.join(root, "node_modules/.bin/tsc");
    if (existsSync(tsc)) {
      const result = await run(tsc, ["--noEmit"], root);
      if (result.code === 0) ok("typecheck passed");
      else fail(`typecheck failed:\n${result.output}`);
    } else warn("skipped typecheck: node_modules/.bin/tsc not found (install dependencies)");

    loadDotEnv(root);
    const url = options.url ?? process.env.DATABASE_URL;
    if (url) {
      const pending = await pendingMigrations(url, path.join(root, project.config.generated_dir, "db/migrations"));
      if (pending.length) fail(`pending migrations: ${pending.join(", ")} (run osl migrate)`);
      else ok("no pending migrations");
      const drift = await checkDrift(url, project.ir, {
        ignoreTables: backendNamed(project.config.backend).runtime(project.config).ignoredTables
      });
      if (drift.length) fail(`drift:\n${formatDrift(drift)}`);
      else ok("no drift");
    } else warn("skipped migrations and drift: DATABASE_URL not set");

    if (options.baseUrl) {
      const vitest = path.join(root, "node_modules/.bin/vitest");
      const result = await run(vitest, ["run"], root, { OSL_BASE_URL: options.baseUrl });
      if (result.code === 0)
        ok(
          `contract tests passed${result.output.match(/Tests\s+(.+)/)?.[1] ? ` (${result.output.match(/Tests\s+(.+)/)![1].trim()})` : ""}`
        );
      else fail(`contract tests failed:\n${result.output.split("\n").slice(-40).join("\n")}`);
    } else warn("skipped contract tests: pass --base-url to run them against a running app");

    if (failed) process.exitCode = 1;
  });

program
  .command("mcp")
  .description("Serve the project to agents over stdio (Model Context Protocol)")
  .action(async () => {
    await startMcp(projectRoot());
  });

program
  .command("conformance [fixtures...]")
  .description("Run the conformance harness on fixtures (OSL_FIXTURES or ./fixtures)")
  .option("--backend <name>", "only this backend")
  .addOption(
    new Option(
      "--package-manager <pm>",
      "install and run the TypeScript projects with this instead of pnpm (skips the snapshot compare)"
    ).choices(["pnpm", "bun", "npm"])
  )
  .option("--update", "rewrite snapshots")
  .option("--snapshot-only", "skip install, database and tests")
  .option("--keep", "keep temp directories")
  .action(
    async (
      fixtures: string[],
      options: { backend?: string; packageManager?: string; update?: boolean; snapshotOnly?: boolean; keep?: boolean }
    ) => {
      const { formatResult, listFixtures, runFixture } = await import("@osl/conformance");
      const root = path.resolve(process.env.OSL_FIXTURES ?? path.join(process.cwd(), "fixtures"));
      const all = (await listFixtures(root)).filter(f => fixtures.length === 0 || fixtures.includes(f.name));
      if (all.length === 0) throw new Error(`no fixtures found in ${root}`);
      let failed = 0;
      let total = 0;
      for (const fixture of all) {
        for (const backend of fixture.backends.filter(b => !options.backend || b === options.backend)) {
          total++;
          console.log(chalk.bold(`\n${fixture.name}`), chalk.gray(`(${backend})`));
          const result = await runFixture(fixture, backend, { ...options, log: line => console.log(line) });
          console.log(formatResult(result));
          if (!result.ok) failed++;
        }
      }
      console.log(`\n${total - failed}/${total} fixture runs passed`);
      if (failed) process.exitCode = 1;
    }
  );

async function staleFiles(root: string, files: GeneratedFile[]): Promise<string[]> {
  const stale: string[] = [];
  for (const file of files) {
    if ((file.mode ?? "generated") !== "generated") continue;
    const target = path.join(root, file.path);
    if (!existsSync(target) || (await readFile(target, "utf8")) !== file.content) stale.push(file.path);
  }
  return stale;
}

function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
): Promise<{ code: number; output: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", d => (output += d));
    child.stderr.on("data", d => (output += d));
    child.on("close", code => resolve({ code: code ?? 1, output }));
  });
}

try {
  await program.parseAsync();
} catch (error) {
  console.error(chalk.red("error:"), error instanceof Error ? error.message : String(error));
  process.exit(1);
}

export { writeFile };
