import type { Backend, GeneratedFile, GenerateInput } from "@osl/core";
import { globalActions, hasSealed, migrationFiles, userActions } from "@osl/core";
import {
  JOBS_DEPENDENCIES,
  STORAGE_DEPENDENCIES,
  actionScaffolds,
  actionsFile,
  authProvidersFile,
  clientFile,
  dockerFiles,
  emailFile,
  eventFiles,
  hasRowActions,
  hasScheduling,
  rowActionsFile,
  schedulingFile,
  testHooksFile,
  filesFile,
  hasInvites,
  hasProviders,
  installCommand,
  jobsFile,
  packageManagerOf,
  presentFile,
  schemaFile,
  storageFile,
  validationFile,
  TANSTACK,
  customPageScaffold,
  dashboardPageFile,
  dashboardRouteFile,
  detailPageFile,
  detailRouteFile,
  inviteAppFile,
  inviteRouteFiles,
  navFile,
  tenantFile,
  resourcePageFile,
  resourceRouteFiles,
  shellScaffolds,
  trpcClientFile,
  uiFile,
  sealFile,
  sealTestFile
} from "@osl/ts-common";
import { APPEARANCES, projectScaffolds, type Appearance } from "./scaffold.js";
import {
  accessFile,
  actionsRouterFile,
  appFile,
  authFile,
  contextFile,
  errorsFile,
  filesRouterFile,
  hooksScaffold,
  resourceRouterFile,
  routerFile,
  serverMainScaffold,
  trpcFile,
  workerScaffold
} from "./server.js";
import { scenarioTestFiles, seedFile, testClientFile, vitestConfigFile } from "./tests.js";
import { VITE, VITE_SERVER } from "./util.js";
import { viteScaffolds } from "./web.js";

export const BACKEND_NAME = "hono-trpc-vite";
export const BACKEND_VERSION = "1.1.0";

/** Pure: the same IR and history always produce the same files, in the same order. */
export function generate(input: GenerateInput): GeneratedFile[] {
  const { ir, revisions, config } = input;
  const gen = config.generated_dir;
  const options = config.backend_options;
  if (options.tailwind === false || options.shadcn === false) {
    throw new Error(
      `${BACKEND_NAME} builds its web app on Tailwind CSS and shadcn/ui; backend_options.tailwind and backend_options.shadcn cannot be false`
    );
  }
  const packageManager = packageManagerOf(config);
  const appearance = (options.appearance ?? "system") as Appearance;
  if (!APPEARANCES.includes(appearance)) {
    throw new Error(
      `backend_options.appearance must be one of ${APPEARANCES.join(", ")}; got ${JSON.stringify(appearance)}`
    );
  }

  const files: GeneratedFile[] = [];

  // Database
  files.push({ path: `${gen}/db/schema.ts`, content: schemaFile(ir, VITE) });
  files.push({ path: `${gen}/db/client.ts`, content: clientFile(VITE, ir) });
  files.push(...migrationFiles(revisions, `${gen}/db/migrations`).files);

  // Shared by the API and the web app
  files.push({
    path: `${gen}/present.ts`,
    content: presentFile(ir, VITE, { access: "./server/access", auth: "./server/auth" })
  });
  files.push({ path: `${gen}/validation.ts`, content: validationFile(ir, VITE, { listInput: "typed" }) });
  if (hasSealed(ir)) {
    files.push({ path: `${gen}/seal.ts`, content: sealFile(ir, VITE) });
    files.push({ path: `${gen}/tests/00_sealed_values.test.ts`, content: sealTestFile(VITE, "../seal") });
  }
  files.push(...eventFiles(ir, VITE));
  if (hasScheduling(ir)) files.push({ path: `${gen}/scheduling.ts`, content: schedulingFile(ir, VITE) });
  files.push({
    path: `${gen}/test-hooks.ts`,
    content: testHooksFile(ir, VITE, { email: hasProviders(ir), access: "./server/access" })
  });
  if (ir.jobs) {
    files.push({ path: `${gen}/jobs.ts`, content: jobsFile(ir, VITE_SERVER) });
    files.push(workerScaffold());
  }
  if (ir.files) {
    files.push({ path: `${gen}/storage.ts`, content: storageFile(ir, VITE_SERVER) });
    files.push({ path: `${gen}/files.ts`, content: filesFile(ir, VITE_SERVER) });
  }
  if (hasProviders(ir)) {
    files.push({ path: `${gen}/email.ts`, content: emailFile(VITE_SERVER, { invite: hasInvites(ir) }) });
    files.push({ path: `${gen}/auth-providers.ts`, content: authProvidersFile(ir, VITE_SERVER) });
  }
  if (hasRowActions(ir)) files.push({ path: `${gen}/row-actions.ts`, content: rowActionsFile(ir, VITE) });
  if (userActions(ir).length) {
    files.push({ path: `${gen}/actions.ts`, content: actionsFile(ir, VITE_SERVER) });
    files.push(...actionScaffolds(ir, VITE_SERVER));
  }

  // API
  files.push({ path: `${gen}/server/trpc.ts`, content: trpcFile(ir) });
  files.push({ path: `${gen}/server/context.ts`, content: contextFile() });
  files.push({ path: `${gen}/server/errors.ts`, content: errorsFile(ir) });
  files.push({ path: `${gen}/server/access.ts`, content: accessFile(ir) });
  files.push({ path: `${gen}/server/auth.ts`, content: authFile(ir) });
  if (ir.files) files.push({ path: `${gen}/server/files-router.ts`, content: filesRouterFile(ir) });
  if (globalActions(ir).length) files.push({ path: `${gen}/server/actions-router.ts`, content: actionsRouterFile(ir) });
  for (const resource of ir.resources) {
    files.push({ path: `${gen}/server/resources/${resource.name}.ts`, content: resourceRouterFile(ir, resource) });
    files.push(hooksScaffold(ir, resource));
  }
  files.push({ path: `${gen}/server/router.ts`, content: routerFile(ir) });
  files.push({ path: `${gen}/server/app.ts`, content: appFile(ir) });
  files.push(serverMainScaffold());

  // Web app
  files.push({ path: `${gen}/app/client.ts`, content: trpcClientFile(ir, VITE) });
  files.push({ path: `${gen}/app/nav.ts`, content: navFile(ir, TANSTACK, VITE) });
  files.push({ path: `${gen}/app/ui.tsx`, content: uiFile(ir, VITE) });
  if (ir.app?.tenant) files.push({ path: `${gen}/app/tenant.tsx`, content: tenantFile(ir, TANSTACK, VITE) });
  if (hasInvites(ir)) {
    files.push({ path: `${gen}/app/invite.tsx`, content: inviteAppFile(ir, TANSTACK, VITE) });
    files.push(...inviteRouteFiles(TANSTACK, VITE));
  }
  for (const page of ir.app?.pages ?? []) {
    if (page.kind === "resource") {
      files.push({ path: `${gen}/app/pages/${page.name}.tsx`, content: resourcePageFile(ir, page, TANSTACK, VITE) });
      files.push(...resourceRouteFiles(ir, page, TANSTACK, VITE));
    } else if (page.kind === "dashboard") {
      files.push({ path: `${gen}/app/pages/${page.name}.tsx`, content: dashboardPageFile(ir, page, TANSTACK, VITE) });
      files.push(dashboardRouteFile(page, TANSTACK, VITE));
    } else if (page.kind === "detail") {
      files.push({ path: `${gen}/app/pages/${page.name}.tsx`, content: detailPageFile(ir, page, TANSTACK, VITE) });
      const route = detailRouteFile(ir, page, TANSTACK, VITE);
      if (route) files.push(route);
    } else files.push(customPageScaffold(page, TANSTACK, VITE));
  }
  files.push(...shellScaffolds(ir, TANSTACK, VITE));
  files.push(...viteScaffolds(ir));
  const extraDependencies = {
    ...(ir.files ? STORAGE_DEPENDENCIES : {}),
    ...(ir.jobs ? JOBS_DEPENDENCIES : {})
  };
  files.push(...projectScaffolds(ir, config, appearance, packageManager, extraDependencies));
  files.push(
    ...dockerFiles(ir, {
      packageManager,
      port: 3111,
      build: [`${packageManager === "pnpm" ? "pnpm" : packageManager === "bun" ? "bun run" : "npm run"} build`],
      start: ["node_modules/.bin/tsx", "src/server/main.ts"],
      worker: Boolean(ir.jobs)
    })
  );

  // Contract tests and seed
  files.push({ path: `${gen}/tests/_client.ts`, content: testClientFile(ir) });
  files.push(...scenarioTestFiles(ir));
  files.push({ path: `${gen}/seed.ts`, content: seedFile(ir) });
  files.push({ path: "vitest.config.mts", content: vitestConfigFile() });

  return files
    .map(f => ({ ...f, path: f.path.replace(/^generated\//, `${gen}/`) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export const honoTrpcViteBackend: Backend = {
  name: BACKEND_NAME,
  version: BACKEND_VERSION,
  generates: [
    "entities",
    "relations",
    "enums",
    "indexes",
    "migrations",
    "resources",
    "actions",
    "rules",
    "auth",
    "files",
    "events",
    "jobs",
    "examples",
    "seed",
    "app"
  ],
  generate,
  handlerGuide: config => ({
    language: "ts",
    files: [
      `${config.generated_dir}/actions.ts`,
      `${config.generated_dir}/db/schema.ts`,
      `${config.generated_dir}/server/errors.ts`,
      `${config.generated_dir}/email.ts`
    ],
    conventions: [
      'ctx.db is the Drizzle client; tables and row types are exported from the generated db/schema module (column keys are the model\'s snake_case names). Import eq, and, desc, sql from "drizzle-orm".',
      "Write through ctx.db.update(table).set({ ... }).where(eq(table.id, ctx.row.id)).returning() and return the fresh row; insert with ctx.db.insert(table).values({ ... }).returning().",
      "Call fail(status, code, message) from the generated server/errors module (the import path is in the stub's comment) to answer with that status; it never returns.",
      "ctx.session is null for anonymous callers (and when a schedule or timer runs the action as the system); ctx.session.user.id is the caller's id. ctx.now is when the action runs; a timer or schedule passes the time it was due, so compare against ctx.now rather than new Date(). Dates are Date objects; nullable columns hold null.",
      "To send mail, await sendEmail({ to, subject, text }) from the generated email module; it logs or captures the message outside production, so sending is safe in tests.",
      'A sealed field (sealed: true in the model) is stored bytes in a row you load: read it with unseal("<table>.<column>", row.<column>) and write it with seal("<table>.<column>", value), both from the generated seal module beside db/; never return, log or compare the stored bytes or the opened value.'
    ].join("\n")
  }),
  runtime: config => ({
    install: [installCommand(packageManagerOf(config))],
    // vite build writes src/routeTree.gen.ts and bundles the web app; tsc then checks both sides
    check: [
      { command: "./node_modules/.bin/vite", args: ["build", "--logLevel", "warn"] },
      { command: "./node_modules/.bin/tsc", args: ["--noEmit"] }
    ],
    serve: port => ({
      command: "./node_modules/.bin/tsx",
      args: ["src/server/main.ts"],
      env: { PORT: String(port), OSL_EMAIL: "capture", OSL_STORAGE: "local", OSL_STORAGE_DIR: "./storage" }
    }),
    test: baseUrl => ({ command: "./node_modules/.bin/vitest", args: ["run"], env: { OSL_BASE_URL: baseUrl } }),
    seed: baseUrl => ({
      command: "./node_modules/.bin/tsx",
      args: [`${config.generated_dir}/seed.ts`],
      env: { OSL_BASE_URL: baseUrl }
    }),
    readyPath: "/healthz",
    migrationsDir: generatedDir => `${generatedDir}/db/migrations`
  })
};
