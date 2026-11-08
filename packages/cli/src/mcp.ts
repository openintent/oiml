/**
 * osl mcp: a stdio MCP server exposing the project to agents.
 * Reads happen on each call so the agent always sees the current state.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DIFF_REFERENCE,
  applyIntent,
  checkDrift,
  formatDrift,
  generateProject,
  listIntents,
  loadProject,
  pendingMigrations,
  readIntent,
  toYaml,
  writeDiff
} from "@osl/core";
import path from "node:path";
import { backendNamed } from "./backends.js";
import { loadDotEnv } from "./env.js";
import { validateCandidate } from "./propose.js";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]
});

export async function startMcp(root: string): Promise<void> {
  const server = new McpServer({ name: "osl", version: "1.0.0" });

  server.registerTool(
    "osl_reference",
    {
      title: "OSL diff reference",
      description: "The model and diff format reference. Read it before writing a diff.",
      inputSchema: {}
    },
    async () => text(DIFF_REFERENCE)
  );

  server.registerTool(
    "osl_status",
    {
      title: "Project status",
      description: "Current model, applied revisions, pending intents and pending migrations.",
      inputSchema: {}
    },
    async () => {
      const project = await loadProject(root);
      const applied = new Set(project.lock.revisions.map(r => r.intent));
      const intents = await listIntents(root);
      let migrations: string | number = "unknown (DATABASE_URL not set)";
      loadDotEnv(root);
      if (process.env.DATABASE_URL) {
        try {
          migrations = (
            await pendingMigrations(
              process.env.DATABASE_URL,
              path.join(root, project.config.generated_dir, "db/migrations")
            )
          ).length;
        } catch (error) {
          migrations = `unknown (${error instanceof Error ? error.message : error})`;
        }
      }
      return text({
        name: project.model.name,
        backend: project.config.backend,
        entities: Object.keys(project.model.entities),
        resources: Object.keys(project.model.resources),
        auth: project.model.auth ?? null,
        revisions: project.lock.revisions.map(r => ({ rev: r.rev, intent: r.intent, summary: r.summary })),
        pending_intents: intents.filter(id => !applied.has(id)),
        pending_migrations: migrations
      });
    }
  );

  server.registerTool(
    "osl_model",
    { title: "Current model", description: "The current .osl/model.yaml.", inputSchema: {} },
    async () => text(toYaml((await loadProject(root)).model))
  );

  server.registerTool(
    "osl_intent",
    {
      title: "Read an intent",
      description: "The intent's prose and its diff, if any.",
      inputSchema: { id: z.string() }
    },
    async ({ id }) => {
      const folder = await readIntent(root, id);
      return text({ id, intent: folder.intent, diff: folder.diff ? toYaml(folder.diff) : null });
    }
  );

  server.registerTool(
    "osl_check_diff",
    {
      title: "Check a diff",
      description:
        "Validate a diff (YAML) against the current model without applying it. Returns problems, or an empty list when it is valid.",
      inputSchema: { diff_yaml: z.string() }
    },
    async ({ diff_yaml }) => {
      const project = await loadProject(root);
      const { problems } = validateCandidate(project.model, diff_yaml);
      return text({ valid: problems.length === 0, problems });
    }
  );

  server.registerTool(
    "osl_write_diff",
    {
      title: "Write an intent's diff",
      description: "Validate a diff and save it as .osl/intents/<id>/diff.yaml for review. Does not apply it.",
      inputSchema: { id: z.string(), diff_yaml: z.string() }
    },
    async ({ id, diff_yaml }) => {
      const project = await loadProject(root);
      const { diff, problems } = validateCandidate(project.model, diff_yaml);
      if (!diff || problems.length) return text({ written: false, problems });
      const file = await writeDiff(root, id, diff);
      return text({ written: true, file });
    }
  );

  server.registerTool(
    "osl_apply",
    {
      title: "Apply an intent",
      description: "Apply .osl/intents/<id>/diff.yaml to the model and record the revision.",
      inputSchema: { id: z.string() }
    },
    async ({ id }) => {
      const outcome = await applyIntent(root, id);
      return text({
        status: outcome.status,
        revision: outcome.revision.rev,
        entities: outcome.ir.entities.map(e => e.name)
      });
    }
  );

  server.registerTool(
    "osl_generate",
    {
      title: "Generate code",
      description: "Run the project's backend and write the generated files.",
      inputSchema: {}
    },
    async () => {
      const project = await loadProject(root);
      const { report } = await generateProject(root, backendNamed(project.config.backend));
      return text(report);
    }
  );

  server.registerTool(
    "osl_drift",
    { title: "Drift check", description: "Compare the database at DATABASE_URL with the model.", inputSchema: {} },
    async () => {
      loadDotEnv(root);
      if (!process.env.DATABASE_URL) return text("DATABASE_URL is not set");
      const project = await loadProject(root);
      return text(formatDrift(await checkDrift(process.env.DATABASE_URL, project.ir)));
    }
  );

  await server.connect(new StdioServerTransport());
}
