import type { Backend, GeneratedFile, GenerateInput } from "@osl/core";
import { globalActions, migrationFiles, openapiDocument } from "@osl/core";
import { actionHandlersFile, actionScaffolds, actionsFile } from "./actions.js";
import { appFile, mainScaffold, openapiFile, workerScaffold } from "./app.js";
import { authFile, authProvidersFile, hasProviders } from "./auth.js";
import { emailFile } from "./email.js";
import { hasScheduling, schedulingFile, testHooksFile } from "./scheduling.js";
import { eventHandlerScaffolds, eventsFile } from "./events.js";
import { filesApiFile, filesFile } from "./files.js";
import { jobsFile } from "./jobs.js";
import { entitiesFile, formatFile, modelFilesFile, valuesFile } from "./models.js";
import { globalActionsFile, hooksScaffold, resourceFile } from "./resources.js";
import { accessFile, dbFile, hooksFile, httpxFile } from "./runtime.js";
import { scaffoldFiles } from "./scaffold.js";
import { storageFile } from "./storage.js";
import { clientFile, clientModelFile, scenarioTestFiles, seedFile, testSupportFile } from "./tests.js";
import { modulePath } from "./util.js";
import { validationResourcesFile, validationRuntimeFile } from "./validation.js";

export const BACKEND_NAME = "gin-pgx";
export const BACKEND_VERSION = "1.1.0";

/** Pure: the same IR and history always produce the same files, in the same order. */
export function generate(input: GenerateInput): GeneratedFile[] {
  const { ir, revisions, config } = input;
  const gen = config.generated_dir;
  const mod = modulePath(ir);
  const files: GeneratedFile[] = [];

  const migrations = migrationFiles(revisions, `${gen}/db/migrations`);
  files.push(...migrations.files);
  files.push({ path: `${gen}/db/db.go`, content: dbFile(mod) });

  files.push({ path: `${gen}/models/values.go`, content: valuesFile(mod) });
  files.push({ path: `${gen}/models/format.go`, content: formatFile(mod) });
  files.push({ path: `${gen}/models/entities.go`, content: entitiesFile(ir, mod) });
  if (ir.files) files.push({ path: `${gen}/models/files.go`, content: modelFilesFile(mod) });
  files.push({ path: `${gen}/httpx/httpx.go`, content: httpxFile(mod) });
  files.push({ path: `${gen}/validation/types.go`, content: validationRuntimeFile(mod) });
  files.push({ path: `${gen}/validation/resources.go`, content: validationResourcesFile(ir, mod) });
  files.push({ path: `${gen}/auth/auth.go`, content: authFile(ir, mod) });
  if (hasProviders(ir)) {
    files.push({ path: `${gen}/auth/providers.go`, content: authProvidersFile(ir, mod) });
    files.push({ path: `${gen}/email/email.go`, content: emailFile(mod) });
  }
  files.push({ path: `${gen}/access/access.go`, content: accessFile(ir, mod) });
  files.push({ path: `${gen}/hooks/hooks.go`, content: hooksFile(mod) });
  if (ir.files) {
    files.push({ path: `${gen}/storage/storage.go`, content: storageFile(mod) });
    files.push({ path: `${gen}/files/files.go`, content: filesFile(ir, mod) });
    files.push({ path: `${gen}/filesapi/api.go`, content: filesApiFile(ir, mod) });
  }
  if (ir.actions.length) {
    files.push({ path: `${gen}/actions/actions.go`, content: actionsFile(ir, mod) });
    files.push({ path: `${gen}/actions/handlers/handlers.go`, content: actionHandlersFile(ir, mod) });
    files.push(...actionScaffolds(ir, mod));
  }
  files.push({ path: `${gen}/events/events.go`, content: eventsFile(ir, mod) });
  files.push(...eventHandlerScaffolds(ir, mod));
  if (ir.jobs) {
    files.push({ path: `${gen}/jobs/jobs.go`, content: jobsFile(mod) });
    files.push(workerScaffold(mod));
  }
  if (hasScheduling(ir)) files.push({ path: `${gen}/scheduling/scheduling.go`, content: schedulingFile(ir, mod) });
  files.push({ path: `${gen}/testhooks/testhooks.go`, content: testHooksFile(ir, mod, { email: hasProviders(ir) }) });

  for (const resource of ir.resources) {
    files.push({ path: `${gen}/resources/${resource.name}.go`, content: resourceFile(ir, resource, mod) });
    files.push(hooksScaffold(ir, resource, mod));
  }
  if (globalActions(ir).some(a => a.rule.kind !== "none"))
    files.push({ path: `${gen}/resources/global_actions.go`, content: globalActionsFile(ir, mod) });

  files.push({ path: `${gen}/openapi.json`, content: JSON.stringify(openapiDocument(ir), null, 2) + "\n" });
  files.push({ path: `${gen}/openapi.go`, content: openapiFile(mod) });
  files.push({ path: `${gen}/app/app.go`, content: appFile(ir, mod) });
  files.push(mainScaffold(mod));

  files.push({ path: `${gen}/client/client.go`, content: clientFile(mod) });
  files.push({ path: `${gen}/client/model.go`, content: clientModelFile(ir, mod) });
  files.push({ path: `${gen}/tests/support_test.go`, content: testSupportFile(mod) });
  files.push(...scenarioTestFiles(ir, mod));
  files.push({ path: "cmd/seed/main.go", content: seedFile(ir, mod) });

  files.push(...scaffoldFiles(ir, mod));

  // Paths are relative to the project root; the generated dir is fixed by config, so rewrite the default
  return files
    .map(f => ({ ...f, path: f.path.replace(/^generated\//, `${gen}/`) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export const ginPgxBackend: Backend = {
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
    language: "go",
    files: [
      `${config.generated_dir}/actions/actions.go`,
      `${config.generated_dir}/models/entities.go`,
      `${config.generated_dir}/httpx/httpx.go`,
      `${config.generated_dir}/email/email.go`
    ],
    conventions: [
      "ctx.DB is a *pgxpool.Pool and ctx.Context() the request's context (or the job's when a schedule or timer runs the action; ctx.Gin is nil then). ctx.Now is when the action runs; a timer or schedule passes the time it was due, so compare against ctx.Now rather than time.Now(). models.<Entity>Table is the quoted table name, models.<Entity>Columns the column list for SELECT and RETURNING, and models.Scan<Entity>(row) scans one row selected with those columns (ctx.DB.QueryRow).",
      "Return httpx.NewError(status, code, message) to answer with that status (the httpx package lives next to the generated/actions package the stub imports); return the plain error for anything unexpected.",
      "ctx.Session is nil for anonymous callers; ctx.Session.User.ID is the caller's id. Nullable columns are pointers, time columns are time.Time; stamp with time.Now().UTC(). Keep the file gofmt-formatted and every import used.",
      "To send mail, call email.Send(ctx.Context(), email.Email{...}) from the generated email package; it logs or captures the message outside production, so sending is safe in tests."
    ].join("\n")
  }),
  runtime: () => ({
    install: [{ command: "go", args: ["mod", "tidy"] }],
    check: [
      {
        command: "sh",
        args: ["-c", 'unformatted=$(gofmt -l .); if [ -n "$unformatted" ]; then echo "gofmt: $unformatted"; exit 1; fi']
      },
      { command: "go", args: ["vet", "./..."] },
      { command: "go", args: ["build", "./..."] }
    ],
    serve: port => ({
      command: "go",
      args: ["run", "./cmd/server"],
      env: { PORT: String(port), OSL_EMAIL: "capture", OSL_STORAGE: "local", OSL_STORAGE_DIR: "./storage" }
    }),
    test: baseUrl => ({ command: "go", args: ["test", "./...", "-count=1"], env: { OSL_BASE_URL: baseUrl } }),
    seed: baseUrl => ({ command: "go", args: ["run", "./cmd/seed"], env: { OSL_BASE_URL: baseUrl } }),
    ignoredTables: ["river_%"],
    readyPath: "/healthz",
    migrationsDir: generatedDir => `${generatedDir}/db/migrations`
  })
};

export { migrationFiles };
