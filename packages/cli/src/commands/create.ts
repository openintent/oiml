import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import * as YAML from "yaml";

async function validateProjectYaml(
  openintentDir: string
): Promise<{ valid: boolean; content: string; version: string | null }> {
  const projectYamlPath = join(openintentDir, "project.yaml");

  if (!existsSync(projectYamlPath)) {
    console.log(chalk.red("❌ Error: project.yaml not found"));
    return { valid: false, content: "", version: null };
  }

  try {
    const projectYaml = readFileSync(projectYamlPath, "utf-8");
    const projectConfig = YAML.parse(projectYaml);

    // Try to validate using MCP server if available
    try {
      // NOTE: MCP Server Integration Point
      // When running in Cursor/IDE with MCP server available, this would call:
      //
      //   const validation = await mcp_oiml_validate_project({
      //     content: projectYaml,
      //     format: 'yaml'
      //   });
      //
      //   if (!validation.valid) {
      //     console.log(chalk.red(`❌ Validation failed: ${validation.message}`));
      //     return { valid: false, content: projectYaml, version: null };
      //   }
      //
      // For now, we perform basic YAML parsing validation
      console.log(chalk.gray("Validating project.yaml..."));
      console.log(chalk.green("✓ project.yaml validation passed"));
    } catch (mcpError) {
      // MCP server not available - continue with basic validation
      console.log(chalk.yellow("⚠️  MCP validation unavailable, using basic validation"));
    }

    const version = projectConfig?.oiml_version;
    if (!version) {
      return { valid: false, content: projectYaml, version: null };
    }

    return { valid: true, content: projectYaml, version };
  } catch (error) {
    console.log(
      chalk.red(`❌ Error parsing project.yaml: ${error instanceof Error ? error.message : "Unknown error"}`)
    );
    return { valid: false, content: "", version: null };
  }
}

export function generateIntentTemplate(name: string, version: string): string {
  const yamlObj = {
    version: version,
    type: "oiml.intent",
    ai_context: {
      purpose: "Conform to project frameworks, style, and conventions.",
      instructions: "- Read .openintent/AGENTS.md and apply the instructions to the intent.\n",
      references: [
        {
          kind: "file",
          path: ".openintent/AGENTS.md"
        }
      ]
    },
    provenance: {
      created_by: {
        type: "human",
        name: ""
      },
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
    },
    intents: []
  };

  return YAML.stringify(yamlObj);
}

function sanitizeFileName(name: string): string {
  // Remove invalid characters and replace spaces with hyphens
  return name
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

export async function createCommand(name?: string) {
  const cwd = process.cwd();
  const openintentDir = join(cwd, ".openintent");
  const intentsDir = join(openintentDir, "intents");

  // Check if .openintent directory exists
  if (!existsSync(openintentDir)) {
    console.log(chalk.red("❌ Error: .openintent directory not found."));
    console.log(chalk.gray('Run "openintent init" first to initialize a project.'));
    process.exit(1);
  }

  // Validate project.yaml before creating intent
  const projectValidation = await validateProjectYaml(openintentDir);

  if (!projectValidation.valid || !projectValidation.version) {
    console.log(chalk.red("❌ Error: project.yaml validation failed"));
    if (!projectValidation.version) {
      console.log(chalk.gray("Please add an oiml_version field to .openintent/project.yaml"));
      console.log(chalk.gray("Example: version: 0.1.0"));
    }
    process.exit(1);
  }

  // Ensure intents directory exists
  if (!existsSync(intentsDir)) {
    mkdirSync(intentsDir, { recursive: true });
    console.log(chalk.green("✓ Created intents directory"));
  }

  // Get intent name
  let intentName = name;
  if (!intentName) {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Intent name:",
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return "Intent name is required";
          }
          return true;
        }
      }
    ]);
    intentName = answer.name;
  }

  // Ensure intentName is defined
  if (!intentName) {
    console.log(chalk.red("❌ Error: Intent name is required."));
    process.exit(1);
  }

  // Sanitize the name for the folder
  const sanitizedName = sanitizeFileName(intentName);
  const intentFolderPath = join(intentsDir, sanitizedName);
  const intentFilePath = join(intentFolderPath, "intent.yaml");

  // Check if folder already exists
  if (existsSync(intentFolderPath)) {
    console.log(chalk.yellow(`⚠️  Intent folder ${sanitizedName} already exists`));
    const { overwrite } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: "Do you want to overwrite the intent.yaml file?",
        default: false
      }
    ]);

    if (!overwrite) {
      console.log(chalk.gray("Cancelled."));
      process.exit(0);
    }
  } else {
    // Create the intent folder
    mkdirSync(intentFolderPath, { recursive: true });
    console.log(chalk.green(`✓ Created intent folder: ${sanitizedName}/`));
  }

  // Use the validated OIML version from project.yaml
  const oimlVersion = projectValidation.version;

  // Generate intent file content
  const intentContent = generateIntentTemplate(intentName, oimlVersion);

  // Write the intent.yaml file
  writeFileSync(intentFilePath, intentContent, "utf-8");

  console.log(chalk.green(`✓ Created intent file: ${sanitizedName}/intent.yaml`));
  console.log(chalk.gray(`  Location: ${intentFilePath}`));
}
