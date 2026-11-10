import type { Backend, GeneratedFile, GenerateInput, IR } from "@osl/core";
import { globalActions, hasSealed, migrationFiles, openapiDocument, userActions } from "@osl/core";
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
  filesFile,
  hasProviders,
  hasRowActions,
  hasScheduling,
  rowActionsFile,
  schedulingFile,
  testHooksFile,
  installCommand,
  jobsFile,
  packageManagerOf,
  presentFile,
  schemaFile,
  storageFile,
  validationFile,
  NEXT_APP,
  customPageScaffold,
  dashboardPageFile,
  dashboardRouteFile,
  navFile,
  resourcePageFile,
  resourceRouteFiles,
  restClientFile,
  shellScaffolds,
  uiFile,
  sealFile,
  sealTestFile
} from "@osl/ts-common";
import { authFile, authRouteFiles } from "./auth.js";
import { filesApiFile, filesRouteFiles } from "./files-api.js";
import { actionsApiFile, globalActionRouteFiles, hooksScaffold, resourceFile, routeFiles } from "./resources.js";
import { accessFile, httpFile } from "./runtime.js";
import { APPEARANCES, APP_DEPENDENCIES, scaffoldFiles, type Appearance } from "./scaffold.js";
import { scenarioTestFiles, seedFile, testClientFile, vitestConfigFile } from "./tests.js";
import { HEADER, NEXT, NEXT_SERVER } from "./util.js";

export const BACKEND_NAME = "drizzle-next";
export const BACKEND_VERSION = "1.1.0";

/** Pure: the same IR and history always produce the same files, in the same order. */
export function generate(input: GenerateInput): GeneratedFile[] {
  const { ir, revisions, config } = input;
  const gen = config.generated_dir;
  const files: GeneratedFile[] = [];
  const packageManager = packageManagerOf(config);

  files.push({ path: `${gen}/db/schema.ts`, content: schemaFile(ir, NEXT) });
  files.push({ path: `${gen}/db/client.ts`, content: clientFile(NEXT, ir) });
  const migrations = migrationFiles(revisions, `${gen}/db/migrations`);
  files.push(...migrations.files);

  files.push({ path: `${gen}/http.ts`, content: httpFile(ir) });
  files.push({ path: `${gen}/access.ts`, content: accessFile(ir) });
  files.push({ path: `${gen}/present.ts`, content: presentFile(ir, NEXT, { access: "./access", auth: "./auth" }) });
  files.push({ path: `${gen}/auth.ts`, content: authFile(ir) });
  files.push({ path: `${gen}/validation.ts`, content: validationFile(ir, NEXT) });
  if (hasSealed(ir)) {
    files.push({ path: `${gen}/seal.ts`, content: sealFile(ir, NEXT) });
    files.push({ path: `${gen}/tests/00_sealed_values.test.ts`, content: sealTestFile(NEXT, "../seal") });
    // The server does not start without the key: instrumentation.ts is where a Next.js server starts
    if (!ir.jobs) files.push(sealStartScaffold());
  }
  files.push(...eventFiles(ir, NEXT));
  if (hasScheduling(ir)) files.push({ path: `${gen}/scheduling.ts`, content: schedulingFile(ir, NEXT) });
  files.push({ path: `${gen}/test-hooks.ts`, content: testHooksFile(ir, NEXT, { email: hasProviders(ir) }) });
  files.push(...testHookRouteFiles(ir, hasProviders(ir)));
  if (ir.jobs) {
    files.push({ path: `${gen}/jobs.ts`, content: jobsFile(ir, NEXT_SERVER) });
    files.push(...workerScaffolds(hasSealed(ir)));
  }
  if (ir.files) {
    files.push({ path: `${gen}/storage.ts`, content: storageFile(ir, NEXT_SERVER) });
    files.push({ path: `${gen}/files.ts`, content: filesFile(ir, NEXT_SERVER) });
    files.push({ path: `${gen}/files-api.ts`, content: filesApiFile(ir) });
    files.push(...filesRouteFiles(ir));
  }
  if (hasProviders(ir)) {
    files.push({ path: `${gen}/email.ts`, content: emailFile(NEXT_SERVER) });
    files.push({ path: `${gen}/auth-providers.ts`, content: authProvidersFile(ir, NEXT_SERVER) });
  }
  if (hasRowActions(ir)) files.push({ path: `${gen}/row-actions.ts`, content: rowActionsFile(ir, NEXT) });
  if (userActions(ir).length) {
    files.push({ path: `${gen}/actions.ts`, content: actionsFile(ir, NEXT_SERVER) });
    files.push(...actionScaffolds(ir, NEXT_SERVER));
  }
  if (globalActions(ir).length) {
    files.push({ path: `${gen}/actions-api.ts`, content: actionsApiFile(ir) });
    files.push(...globalActionRouteFiles(ir));
  }

  for (const resource of ir.resources) {
    files.push({ path: `${gen}/resources/${resource.name}.ts`, content: resourceFile(ir, resource) });
    files.push(...routeFiles(ir, resource));
    files.push(hooksScaffold(ir, resource));
  }
  files.push(...authRouteFiles(ir));

  files.push({ path: `${gen}/openapi.json`, content: JSON.stringify(openapiDocument(ir), null, 2) + "\n" });
  files.push({
    path: "app/api/openapi.json/route.ts",
    content: `${HEADER("Serves the OpenAPI document for the REST contract.")}
import spec from "@/generated/openapi.json";

export function GET(): Response {
  return Response.json(spec);
}
`
  });

  // The web app, when the model declares one: the shell and pages under app/(app) with the sidebar
  if (ir.app) {
    files.push({ path: `${gen}/app/client.ts`, content: restClientFile(ir, NEXT) });
    files.push({ path: `${gen}/app/nav.ts`, content: navFile(ir, NEXT_APP, NEXT) });
    files.push({ path: `${gen}/app/ui.tsx`, content: uiFile(ir, NEXT) });
    for (const page of ir.app.pages) {
      if (page.kind === "resource") {
        files.push({ path: `${gen}/app/pages/${page.name}.tsx`, content: resourcePageFile(ir, page, NEXT_APP, NEXT) });
        files.push(...resourceRouteFiles(ir, page, NEXT_APP, NEXT));
      } else if (page.kind === "dashboard") {
        files.push({ path: `${gen}/app/pages/${page.name}.tsx`, content: dashboardPageFile(ir, page, NEXT_APP, NEXT) });
        files.push(dashboardRouteFile(page, NEXT_APP, NEXT));
      } else files.push(customPageScaffold(page, NEXT_APP, NEXT));
    }
    files.push(...shellScaffolds(ir, NEXT_APP, NEXT));
    files.push(...nextAppScaffolds());
  }

  files.push({ path: `${gen}/tests/_client.ts`, content: testClientFile(ir) });
  files.push(...scenarioTestFiles(ir));
  files.push({ path: `${gen}/seed.ts`, content: seedFile(ir) });
  files.push({ path: "vitest.config.mts", content: vitestConfigFile() });

  const appearance = (config.backend_options.appearance ?? "system") as Appearance;
  if (!APPEARANCES.includes(appearance)) {
    throw new Error(
      `backend_options.appearance must be one of ${APPEARANCES.join(", ")}; got ${JSON.stringify(appearance)}`
    );
  }
  files.push(
    ...scaffoldFiles(ir, {
      tailwind: config.backend_options.tailwind !== false,
      shadcn: config.backend_options.shadcn !== false,
      appearance,
      generatedDir: gen,
      extraDependencies: {
        ...(ir.files ? STORAGE_DEPENDENCIES : {}),
        ...(ir.jobs ? JOBS_DEPENDENCIES : {}),
        ...(ir.app ? APP_DEPENDENCIES : {})
      },
      app: Boolean(ir.app)
    })
  );
  files.push(
    ...dockerFiles(ir, {
      packageManager,
      port: 3000,
      build: [`${packageManager === "pnpm" ? "pnpm" : packageManager === "bun" ? "bun run" : "npm run"} build`],
      start: ["node_modules/.bin/next", "start"],
      worker: Boolean(ir.jobs)
    })
  );

  // Paths are relative to the project root; the generated dir is fixed by config, so rewrite the default
  return files
    .map(f => ({ ...f, path: f.path.replace(/^generated\//, `${gen}/`) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The route group that wraps the app's pages in the shell, and the client-side providers it needs */
function nextAppScaffolds(): GeneratedFile[] {
  return [
    {
      path: "app/providers.tsx",
      mode: "scaffold",
      content: `${NEXT.scaffoldHeader("Client-side providers for the app's pages.")}
"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryClient } from "@/generated/app/client";

export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
`
    },
    {
      path: "app/(app)/layout.tsx",
      mode: "scaffold",
      content: `${NEXT.scaffoldHeader("Every page under this group renders inside the app shell with the sidebar.")}
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/app/providers";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
`
    }
  ];
}

/** The test hooks' routes: a 404 unless OSL_TEST_HOOKS=1, so production never has them */
function testHookRouteFiles(ir: IR, email: boolean): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const route = (path: string, what: string, body: string) =>
    files.push({
      path: `app/api/osl-hooks/${path}/route.ts`,
      content: `${HEADER(`Test hook: ${what}. Answers 404 unless OSL_TEST_HOOKS=1.`)}
import { emailsSent, schedulesRun, testHooksEnabled, timersRun } from "@/generated/test-hooks";
import { error, notFound, ok } from "@/generated/http";

${body}
`
    });
  if (hasScheduling(ir)) {
    route(
      "timers/run",
      "run every timer due at the given moment",
      `export async function POST(request: Request): Promise<Response> {
  if (!testHooksEnabled()) return notFound();
  void emailsSent;
  void schedulesRun;
  void error;
  return ok(await timersRun(await request.json().catch(() => ({}))));
}`
    );
    route(
      "schedules/run",
      "run a schedule's action now",
      `export async function POST(request: Request): Promise<Response> {
  if (!testHooksEnabled()) return notFound();
  void emailsSent;
  void timersRun;
  const result = await schedulesRun(await request.json().catch(() => ({})));
  return result ? ok(result) : error(400, "unknown_schedule", "no schedule runs that action");
}`
    );
  }
  if (ir.auth?.tenancy?.isolation) {
    // The two hooks of the cross-tenant walk's second pass: the rule checks switched off, and the unbound probe
    const isolationRoute = (path: string, what: string, body: string) =>
      files.push({
        path: `app/api/osl-hooks/${path}/route.ts`,
        content: `${HEADER(`Test hook: ${what}. Answers 404 unless OSL_TEST_HOOKS=1.`)}
import { rulesSwitch, tenancyUnbound, testHooksEnabled } from "@/generated/test-hooks";
import { notFound, ok } from "@/generated/http";

${body}
`
      });
    for (const state of ["off", "on"] as const)
      isolationRoute(
        `rules/${state}`,
        `switch the generated rule checks ${state}`,
        `export async function POST(): Promise<Response> {
  if (!testHooksEnabled()) return notFound();
  void tenancyUnbound;
  return ok(rulesSwitch(${state === "off"}));
}`
      );
    isolationRoute(
      "tenancy/unbound",
      "what the app's database role reads of every tenant table with no tenant bound",
      `export async function GET(): Promise<Response> {
  if (!testHooksEnabled()) return notFound();
  void rulesSwitch;
  return ok(await tenancyUnbound());
}`
    );
  }
  if (email) {
    route(
      "emails",
      "the captured mailbox",
      `export async function GET(request: Request): Promise<Response> {
  if (!testHooksEnabled()) return notFound();
  void schedulesRun;
  void timersRun;
  void error;
  const url = new URL(request.url);
  return ok(emailsSent({ to: url.searchParams.get("to") ?? undefined, subject: url.searchParams.get("subject") ?? undefined }));
}`
    );
  }
  return files;
}

/** What instrumentation.ts does first when the model has a sealed field: no key, no server */
const SEAL_START = `    // Sealed fields: the server does not start without OSL_SEAL_KEY, or with one that is not a key.
    const { sealKey } = await import("./generated/seal");
    sealKey();
`;

/** instrumentation.ts for a model with a sealed field and no queue: the key is checked as the server starts */
function sealStartScaffold(): GeneratedFile {
  return {
    path: "instrumentation.ts",
    mode: "scaffold",
    content: `// Created once by OSL (@osl/backend-drizzle-next). Runs when the Next.js server starts.
// You own this file: OSL never rewrites it.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
${SEAL_START}  }
}
`
  };
}

/** instrumentation.ts runs when the Next.js server starts: the place to run queued events; src/worker.ts for a separate process */
function workerScaffolds(sealed = false): GeneratedFile[] {
  return [
    {
      path: "instrumentation.ts",
      mode: "scaffold",
      content: `// Created once by OSL (@osl/backend-drizzle-next). Runs when the Next.js server starts.
// You own this file: OSL never rewrites it.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
${sealed ? SEAL_START : ""}    // Queued events run in this process unless OSL_ROLE=web (then run src/worker.ts separately).
    const { startWorker } = await import("./generated/jobs");
    await startWorker();
  }
}
`
    },
    {
      path: "src/worker.ts",
      mode: "scaffold",
      content: `// Created once by OSL (@osl/backend-drizzle-next). A process that only runs queued events: tsx src/worker.ts
// You own this file: OSL never rewrites it.
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.OSL_ROLE = "worker";

const { startWorker } = await import("../generated/jobs");
await startWorker();
console.log("worker running");
`
    }
  ];
}

export const drizzleNextBackend: Backend = {
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
    "openapi"
  ],
  generate,
  handlerGuide: config => ({
    language: "ts",
    files: [
      `${config.generated_dir}/actions.ts`,
      `${config.generated_dir}/db/schema.ts`,
      `${config.generated_dir}/http.ts`,
      `${config.generated_dir}/email.ts`
    ],
    conventions: [
      'ctx.db is the Drizzle client; tables and row types are exported from the generated db/schema module (column keys are the model\'s snake_case names). Import eq, and, desc, sql from "drizzle-orm".',
      "Write through ctx.db.update(table).set({ ... }).where(eq(table.id, ctx.row.id)).returning() and return the fresh row; insert with ctx.db.insert(table).values({ ... }).returning().",
      "Throw new HttpError(status, code, message) from the generated http module (the import path is in the stub's comment) to answer with that status.",
      "ctx.session is null for anonymous callers (and when a schedule or timer runs the action as the system); ctx.session.user.id is the caller's id. ctx.now is when the action runs; a timer or schedule passes the time it was due, so compare against ctx.now rather than new Date(). Dates are Date objects; nullable columns hold null.",
      "To send mail, await sendEmail({ to, subject, text }) from the generated email module; it logs or captures the message outside production, so sending is safe in tests.",
      'A sealed field (sealed: true in the model) is stored bytes in a row you load: read it with unseal("<table>.<column>", row.<column>) and write it with seal("<table>.<column>", value), both from the generated seal module beside db/; never return, log or compare the stored bytes or the opened value.'
    ].join("\n")
  }),
  runtime: config => ({
    install: [installCommand(packageManagerOf(config))],
    check: [{ command: "./node_modules/.bin/tsc", args: ["--noEmit"] }],
    serve: port => ({
      command: "./node_modules/.bin/next",
      args: ["dev", "-p", String(port)],
      env: { NODE_ENV: "development", OSL_EMAIL: "capture", OSL_STORAGE: "local", OSL_STORAGE_DIR: "./storage" }
    }),
    test: baseUrl => ({ command: "./node_modules/.bin/vitest", args: ["run"], env: { OSL_BASE_URL: baseUrl } }),
    seed: baseUrl => ({
      command: "./node_modules/.bin/tsx",
      args: [`${config.generated_dir}/seed.ts`],
      env: { OSL_BASE_URL: baseUrl }
    }),
    readyPath: "/",
    migrationsDir: generatedDir => `${generatedDir}/db/migrations`
  })
};

export { migrationFiles };
