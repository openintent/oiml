import { z } from "zod";
import { OIMLVersion } from "../util";

/** Project Configuration Schema */
export const ProjectConfig = z
  .object({
    name: z.string().min(1).describe("Project name"),
    description: z.string().optional().describe("Project description (can be multiline)"),
    version: OIMLVersion,
    framework: z
      .enum(["nextjs", "express", "fastify", "koa", "nestjs", "remix", "sveltekit", "astro"])
      .optional()
      .describe("Web framework used"),
    language: z.enum(["typescript", "javascript"]).optional().describe("Primary programming language"),

    provider: z
      .object({
        name: z
          .enum(["aws", "gcp", "azure", "vercel", "netlify", "railway", "render", "fly", "digitalocean"])
          .describe("Cloud provider name"),
        region: z.string().describe("Deployment region (e.g., 'us-east-1', 'eu-west-1')")
      })
      .optional()
      .describe("Cloud provider configuration"),

    database: z
      .object({
        type: z
          .enum(["postgres", "mysql", "sqlite", "mongodb", "cockroachdb", "mariadb", "mssql"])
          .describe("Database type"),
        schema: z.string().describe("Path to schema file (e.g., 'prisma/schema.prisma', 'schema.sql')"),
        connection: z.string().describe("Database connection string (can use env:VAR_NAME format)")
      })
      .optional()
      .describe("Database configuration"),

    auth: z
      .object({
        provider: z
          .enum(["next-auth", "auth0", "clerk", "supabase", "firebase", "custom"])
          .describe("Authentication provider"),
        adapter: z.string().optional().describe("Adapter name (e.g., 'prisma', 'mongodb')"),
        sessionStrategy: z.enum(["jwt", "database", "hybrid"]).optional().describe("Session strategy")
      })
      .optional()
      .describe("Authentication configuration"),

    paths: z
      .object({
        api: z.string().optional().describe("API routes directory"),
        components: z.string().optional().describe("Components directory"),
        database: z.string().optional().describe("DB/schema directory"),
        utils: z.string().optional().describe("Utilities directory"),
        types: z.string().optional().describe("TypeScript types directory"),
        tests: z.string().optional().describe("Tests directory")
      })
      .strict()
      .optional()
      .describe("Project directory paths"),

    ui: z
      .object({
        base_components: z
          .array(z.record(z.string()))
          .optional()
          .describe("Map of base UI component names to import paths (e.g., [{ Input: '@/components/ui/input' }])"),
        theme: z
          .object({
            primary_color: z
              .string()
              .regex(/^#[0-9A-Fa-f]{6}$/, "must be hex color")
              .optional()
              .describe("Primary theme color (hex format)"),
            accent_color: z
              .string()
              .regex(/^#[0-9A-Fa-f]{6}$/, "must be hex color")
              .optional()
              .describe("Accent theme color (hex format)"),
            border_radius: z.string().optional().describe("Border radius value (e.g., '0.75rem', '8px')")
          })
          .optional()
          .describe("UI theme configuration")
      })
      .optional()
      .describe("UI configuration"),

    adapters: z
      .object({
        auth: z
          .object({
            provider: z.string().describe("Auth adapter provider"),
            options: z.record(z.string()).optional().describe("Adapter options (can use env:VAR_NAME format)")
          })
          .optional(),
        storage: z
          .object({
            provider: z.enum(["s3", "gcs", "azure-blob", "cloudflare-r2", "local"]).describe("Storage provider"),
            bucket: z.string().optional().describe("Storage bucket/container name"),
            region: z.string().optional().describe("Storage region")
          })
          .optional()
      })
      .optional()
      .describe("Adapter configurations"),

    lint: z
      .object({
        eslint: z.boolean().optional().describe("Enable ESLint"),
        prettier: z.boolean().optional().describe("Enable Prettier")
      })
      .optional()
      .describe("Linting configuration"),

    build: z
      .object({
        command: z.string().optional().describe("Build command (e.g., 'pnpm build', 'npm run build')"),
        output: z.string().optional().describe("Build output directory (e.g., '.next', 'dist')"),
        framework: z.string().optional().describe("Build framework")
      })
      .optional()
      .describe("Build configuration"),

    deploy: z
      .object({
        provider: z
          .enum(["vercel", "netlify", "aws", "gcp", "azure", "railway", "render", "fly"])
          .describe("Deployment provider"),
        region: z.string().optional().describe("Deployment region"),
        env: z.enum(["production", "staging", "development"]).optional().describe("Deployment environment")
      })
      .optional()
      .describe("Deployment configuration"),

    policies: z
      .object({
        max_files_changed: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of files that can be changed in a single intent"),
        max_loc_added: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum lines of code that can be added in a single intent"),
        forbidden_paths: z.array(z.string()).optional().describe("Paths that cannot be modified by intents"),
        reviewers_required: z.number().int().nonnegative().optional().describe("Number of required reviewers"),
        tests_required: z.boolean().optional().describe("Whether tests are required before applying intents")
      })
      .optional()
      .describe("Project policies and constraints"),

    intents: z
      .object({
        directory: z.string().default(".openintent/intents").describe("Directory containing intent files"),
        schema_version: z.union([z.string(), z.number()]).optional().describe("OpenIntent schema version"),
        default_review_policy: z
          .enum(["auto", "manual", "require-review"])
          .optional()
          .describe("Default review policy for intents")
      })
      .optional()
      .describe("Intent configuration"),

    metadata: z
      .object({
        maintainers: z
          .array(
            z.object({
              name: z.string().describe("Maintainer name"),
              email: z.string().email().optional().describe("Maintainer email")
            })
          )
          .optional()
          .describe("Project maintainers"),
        license: z.string().optional().describe("License type (e.g., 'MIT', 'Apache-2.0')"),
        repository: z.string().url().optional().describe("Repository URL")
      })
      .optional()
      .describe("Project metadata")
  })
  .strict();

export type ProjectConfig = z.infer<typeof ProjectConfig>;
