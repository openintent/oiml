import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import * as YAML from "yaml";
import { generateIntentTemplate } from "./create.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Map API languages to their frameworks
const API_FRAMEWORKS_BY_LANGUAGE: Record<string, string[]> = {
  typescript: ["next", "express", "fastify", "koa", "nestjs", "remix", "sveltekit", "astro"],
  javascript: ["next", "express", "fastify", "koa", "nestjs", "remix", "sveltekit", "astro"],
  python: ["django", "flask", "fastapi", "tornado", "bottle"],
  go: ["gin", "echo", "fiber", "chi", "gorilla"],
  rust: ["axum", "actix-web", "rocket", "warp"],
  java: ["spring-boot", "quarkus", "micronaut"],
  ruby: ["rails", "sinatra"],
  php: ["laravel", "symfony"],
  csharp: ["aspnet"],
  swift: [],
  kotlin: [],
  elixir: [],
  dart: [],
  scala: []
};

// Map UI languages to their frameworks (most work with both TS/JS)
const UI_FRAMEWORKS_BY_LANGUAGE: Record<string, string[]> = {
  typescript: ["react", "vue", "sveltekit", "astro", "next", "vite", "nuxt"],
  javascript: ["react", "vue", "sveltekit", "astro", "next", "vite", "nuxt"]
};

// Get framework choices for a given language
function getApiFrameworkChoices(language: string | undefined): string[] {
  if (!language) {
    // Return all frameworks if no language selected
    return [
      "next",
      "express",
      "fastify",
      "koa",
      "nestjs",
      "remix",
      "django",
      "flask",
      "fastapi",
      "tornado",
      "bottle",
      "gin",
      "echo",
      "fiber",
      "chi",
      "gorilla",
      "axum",
      "actix-web",
      "rocket",
      "warp",
      "spring-boot",
      "quarkus",
      "micronaut",
      "rails",
      "sinatra",
      "laravel",
      "symfony",
      "aspnet",
      "sveltekit",
      "astro",
      "other",
      "none"
    ];
  }

  const frameworks = API_FRAMEWORKS_BY_LANGUAGE[language] || [];
  return [...frameworks, "other", "none"];
}

function getUiFrameworkChoices(language: string | undefined): string[] {
  if (!language) {
    return ["react", "vue", "sveltekit", "astro", "next", "vite", "nuxt", "other", "none"];
  }

  const frameworks = UI_FRAMEWORKS_BY_LANGUAGE[language] || [];
  return [...frameworks, "other", "none"];
}

interface ProjectConfig {
  name: string;
  description: string;
  version: string;
  api?: {
    framework?: string;
    language?: string;
  };
  database?: {
    type?: string;
    framework?: string;
    schema?: string;
    connection?: string;
  };
  ui?: {
    framework?: string;
    components?: string;
    language?: string;
    base_components?: Array<{ [key: string]: string }>;
    theme?: {
      primary_color?: string;
      accent_color?: string;
      border_radius?: string;
    };
  };
  provider?: {
    name: string;
    region: string;
  };
  auth?: {
    provider: string;
    adapter?: string;
    sessionStrategy?: string;
  };
  paths?: {
    api?: string;
    components?: string;
    entities?: string;
    utils?: string;
    types?: string;
    tests?: string;
  };
  intents?: {
    directory: string;
  };
  metadata?: {
    maintainers?: Array<{ name: string; email?: string }>;
    license?: string;
    repository?: string;
  };
}

async function detectProjectType(): Promise<Partial<ProjectConfig>> {
  const packageJsonPath = resolve(process.cwd(), "package.json");
  let uiFramework: string | undefined;
  let apiFramework: string | undefined;
  let language = "typescript";
  let database: ProjectConfig["database"] | undefined;

  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

      // Detect UI framework
      if (packageJson.dependencies?.next || packageJson.devDependencies?.next) {
        uiFramework = "next";
        apiFramework = "next";
      } else if (
        packageJson.dependencies?.["@sveltejs/kit"] ||
        packageJson.devDependencies?.["@sveltejs/kit"] ||
        existsSync(resolve(process.cwd(), "svelte.config.js")) ||
        existsSync(resolve(process.cwd(), "svelte.config.ts"))
      ) {
        uiFramework = "sveltekit";
        apiFramework = "sveltekit";
      } else if (
        packageJson.dependencies?.astro ||
        packageJson.devDependencies?.astro ||
        existsSync(resolve(process.cwd(), "astro.config.js")) ||
        existsSync(resolve(process.cwd(), "astro.config.mjs")) ||
        existsSync(resolve(process.cwd(), "astro.config.ts"))
      ) {
        uiFramework = "astro";
        apiFramework = "astro";
      } else if (
        packageJson.dependencies?.nuxt ||
        packageJson.devDependencies?.nuxt ||
        existsSync(resolve(process.cwd(), "nuxt.config.js")) ||
        existsSync(resolve(process.cwd(), "nuxt.config.ts"))
      ) {
        uiFramework = "nuxt";
      } else if (
        packageJson.dependencies?.vite ||
        packageJson.devDependencies?.vite ||
        existsSync(resolve(process.cwd(), "vite.config.js")) ||
        existsSync(resolve(process.cwd(), "vite.config.ts"))
      ) {
        uiFramework = "vite";
      } else if (packageJson.dependencies?.react || packageJson.devDependencies?.react) {
        uiFramework = "react";
      } else if (packageJson.dependencies?.vue || packageJson.devDependencies?.vue) {
        uiFramework = "vue";
      }

      // Detect API framework (if different from UI)
      if (!apiFramework) {
        if (
          packageJson.dependencies?.remix ||
          packageJson.devDependencies?.remix ||
          existsSync(resolve(process.cwd(), "remix.config.js")) ||
          existsSync(resolve(process.cwd(), "remix.config.ts"))
        ) {
          apiFramework = "remix";
        } else if (packageJson.dependencies?.express || packageJson.devDependencies?.express) {
          apiFramework = "express";
        } else if (packageJson.dependencies?.fastify || packageJson.devDependencies?.fastify) {
          apiFramework = "fastify";
        } else if (packageJson.dependencies?.koa || packageJson.devDependencies?.koa) {
          apiFramework = "koa";
        } else if (packageJson.dependencies?.["@nestjs/core"] || packageJson.devDependencies?.["@nestjs/core"]) {
          apiFramework = "nestjs";
        }
      }

      // Detect language
      if (existsSync(resolve(process.cwd(), "tsconfig.json"))) {
        language = "typescript";
      } else if (packageJson.type === "module") {
        language = "javascript";
      } else {
        language = "javascript";
      }

      // Detect database
      if (packageJson.dependencies?.prisma || packageJson.devDependencies?.prisma) {
        if (existsSync(resolve(process.cwd(), "prisma", "schema.prisma"))) {
          database = {
            type: "postgres",
            framework: "prisma",
            schema: "prisma/schema.prisma",
            connection: "env:DATABASE_URL"
          };
        }
      }
    } catch (error) {
      // Ignore errors in package.json parsing
    }
  }

  return {
    ui: uiFramework ? { framework: uiFramework, language } : undefined,
    api: apiFramework ? { framework: apiFramework, language } : undefined,
    database
  };
}

async function promptForProjectDetails(detected: Partial<ProjectConfig>, skipPrompts: boolean): Promise<ProjectConfig> {
  const packageJsonPath = resolve(process.cwd(), "package.json");
  let defaultName = "MyProject";
  let defaultDescription = "";
  const oimlVersion = "0.1.0";

  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      defaultName = packageJson.name || defaultName;
      defaultDescription = packageJson.description || defaultDescription;
    } catch (error) {
      // Ignore errors
    }
  }

  if (skipPrompts) {
    return {
      name: defaultName,
      description: defaultDescription,
      version: oimlVersion,
      ui: detected.ui || { framework: "react", language: "typescript" },
      api: detected.api || { framework: "express", language: "typescript" },
      database: detected.database,
      intents: {
        directory: ".oiml/intents"
      }
    };
  }

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Project name:",
      default: defaultName
    },
    {
      type: "input",
      name: "description",
      message: "Project description:",
      default: defaultDescription
    },
    // UI: Ask if they want UI first (framework with "none" option)
    {
      type: "list",
      name: "uiFramework",
      message: "UI Framework:",
      choices: ["react", "vue", "sveltekit", "astro", "next", "vite", "nuxt", "other", "none"],
      default: detected.ui?.framework || "react"
    },
    {
      type: "list",
      name: "uiLanguage",
      message: "UI Language:",
      choices: ["typescript", "javascript"],
      default: detected.ui?.language || "typescript",
      // Always ask language so we can create object even if framework is "none"
      when: () => true
    },
    {
      type: "list",
      name: "uiComponents",
      message: "UI Components Library:",
      choices: ["shadcn/ui", "tailwindcss", "other"],
      default: "shadcn/ui",
      when: (answers: any) => answers.uiFramework && answers.uiFramework !== "none"
    },
    // API: Ask language first, then framework filtered by language
    {
      type: "list",
      name: "apiLanguage",
      message: "API Language:",
      choices: [
        "typescript",
        "javascript",
        "python",
        "go",
        "rust",
        "java",
        "ruby",
        "php",
        "csharp",
        "swift",
        "kotlin",
        "elixir",
        "dart",
        "scala"
      ],
      default: detected.api?.language || "typescript"
    },
    {
      type: "list",
      name: "apiFramework",
      message: "API Framework:",
      choices: (answers: any) => getApiFrameworkChoices(answers.apiLanguage),
      default: (answers: any) => {
        const choices = getApiFrameworkChoices(answers.apiLanguage);
        const detectedFramework = detected.api?.framework;
        if (choices.includes(detectedFramework || "")) {
          return detectedFramework || choices[0];
        }
        // If detected framework not in choices, return first non-"none" option or "none"
        return choices.find((f: string) => f !== "none") || "none";
      }
    },
    {
      type: "list",
      name: "databaseType",
      message: "Database Type:",
      choices: ["postgres", "mysql", "sqlite", "mongodb", "cockroachdb", "mariadb", "mssql", "other", "none"],
      default: detected.database?.type || "postgres"
    },
    {
      type: "list",
      name: "databaseFramework",
      message: "Database Framework:",
      choices: ["prisma", "drizzle", "sqlalchemy", "ent", "gorm", "sqlx", "raw", "other"],
      default: detected.database?.framework || "prisma",
      when: (answers: any) => answers.databaseType !== "other" && answers.databaseType !== "none"
    }
  ]);

  const config: ProjectConfig = {
    name: answers.name,
    description: answers.description,
    version: oimlVersion,
    intents: {
      directory: ".oiml/intents"
    }
  };

  // Add UI if framework is not "none", or if language is selected (even with "none" framework)
  if (answers.uiFramework && answers.uiFramework !== "none") {
    config.ui = {
      framework: answers.uiFramework,
      components: answers.uiComponents,
      language: answers.uiLanguage || "typescript"
    };
  } else if (answers.uiLanguage) {
    // Language was selected but framework is "none" - create object without framework field
    config.ui = {
      language: answers.uiLanguage
    };
  }

  // Add API if language is selected (always for API)
  // If framework is "none", omit the framework field
  if (answers.apiLanguage) {
    const apiConfig: any = {
      language: answers.apiLanguage
    };
    if (answers.apiFramework && answers.apiFramework !== "none") {
      apiConfig.framework = answers.apiFramework;
    }
    config.api = apiConfig;
  }

  // Only add database if not "none"
  if (answers.databaseType !== "none") {
    config.database = {
      type: answers.databaseType,
      framework: answers.databaseFramework,
      schema:
        answers.databaseType === "postgres" && answers.databaseFramework === "prisma"
          ? "prisma/schema.prisma"
          : undefined,
      connection: "env:DATABASE_URL"
    };
  }

  return config;
}

function generateProjectYaml(config: ProjectConfig): string {
  // Generate YAML with schema reference comment at the top
  const schemaReference =
    "# Schema reference: https://github.com/openintent/oiml/blob/main/packages/schema/project/index.ts\n";

  const yamlObj: any = {
    name: config.name,
    description: config.description,
    version: config.version
  };

  // Include API if it exists (even if framework is "none")
  if (config.api) {
    yamlObj.api = config.api;
  }

  // Only include database if it exists and type is not "none"
  if (config.database && config.database.type !== "none") {
    yamlObj.database = config.database;
  }

  // Include UI if it exists (even if framework is "none" but language is set)
  if (config.ui) {
    yamlObj.ui = config.ui;
  }

  if (config.provider) {
    yamlObj.provider = config.provider;
  }

  if (config.auth) {
    yamlObj.auth = config.auth;
  }

  if (config.paths) {
    yamlObj.paths = config.paths;
  }

  if (config.intents) {
    yamlObj.intents = config.intents;
  }

  if (config.metadata) {
    yamlObj.metadata = config.metadata;
  }

  return schemaReference + YAML.stringify(yamlObj);
}

export async function initCommand(options: { yes?: boolean }) {
  const cwd = process.cwd();
  const openintentDir = join(cwd, ".oiml");
  const intentsDir = join(openintentDir, "intents");
  const projectYamlPath = join(openintentDir, "project.yaml");

  // Check if .oiml already exists
  if (existsSync(openintentDir)) {
    console.log(chalk.yellow("⚠️  .oiml directory already exists"));
    const { overwrite } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: "Do you want to overwrite the existing project.yaml?",
        default: false
      }
    ]);

    if (!overwrite) {
      console.log(chalk.gray("Cancelled."));
      process.exit(0);
    }
  } else {
    // Create .oiml directory
    mkdirSync(openintentDir, { recursive: true });
    console.log(chalk.green("✓ Created .oiml directory"));
  }

  // Detect project type
  const detected = await detectProjectType();
  const detectedInfo =
    [
      detected.ui?.framework && `UI: ${detected.ui.framework}`,
      detected.api?.framework && `API: ${detected.api.framework}`,
      detected.database?.type && `DB: ${detected.database.type}`
    ]
      .filter(Boolean)
      .join(", ") || "unknown";
  console.log(chalk.blue("🔍 Detected project type:"), detectedInfo);

  // Prompt for project details
  const config = await promptForProjectDetails(detected, options.yes || false);

  // Generate project.yaml
  const projectYaml = generateProjectYaml(config);
  writeFileSync(projectYamlPath, projectYaml, "utf-8");
  console.log(chalk.green("✓ Created project.yaml"));

  // Create intents directory
  if (!existsSync(intentsDir)) {
    mkdirSync(intentsDir, { recursive: true });
    // Create .gitkeep to ensure the directory is tracked
    writeFileSync(join(intentsDir, ".gitkeep"), "", "utf-8");
    console.log(chalk.green("✓ Created intents directory"));
  }

  // Create 🚀 folder with intent.yaml
  const initIntentDir = join(intentsDir, "🚀");
  if (!existsSync(initIntentDir)) {
    mkdirSync(initIntentDir, { recursive: true });
    const initIntentPath = join(initIntentDir, "intent.yaml");
    const initIntentContent = generateIntentTemplate("🚀", config.version);
    writeFileSync(initIntentPath, initIntentContent, "utf-8");
    console.log(chalk.green("✓ Created 🚀/intent.yaml"));
  }

  // Note: AGENTS.md is now available via MCP tool `get_agents_guide`
  // No need to copy the file to each project - agents can fetch it when needed

  console.log(chalk.green("\n✨ OIML project initialized successfully!"));
  console.log(chalk.gray("\nNext steps:"));
  console.log(chalk.gray("  - Create intent files in .oiml/intents/"));
  console.log(chalk.gray("  - Customize .oiml/project.yaml"));
}
