import type { Backend, GeneratedFile, GenerateInput } from "@osl/core";
import { globalActions, migrationFiles, openapiDocument } from "@osl/core";
import { actionHandlersFile, actionScaffolds, actionsFile } from "./actions.js";
import { appFile, mainScaffold, openapiFile, workerScaffold } from "./app.js";
import { authFile, authProvidersFile, hasProviders } from "./auth.js";
import { emailFile } from "./email.js";
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
