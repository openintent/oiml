import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import * as YAML from "yaml";
import { getOimlVersion } from "../util.js";

function generateIntentTemplate(name: string): string {
  const yamlObj = {
    version: getOimlVersion(),
    ai_context: {
      purpose: "Conform to project frameworks, style, and conventions.",
      instructions:
        "- Read .openintent/AGENTS.md and apply the instructions to the intent.\n",
      references: [
        {
          kind: "file",
          path: ".openintent/AGENTS.md",
        },
      ],
    },
    provenance: {
      created_by: {
        type: "human",
        name: "",
      },
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    },
    intents: [],
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
    console.log(
      chalk.gray('Run "openintent init" first to initialize a project.'),
    );
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
        },
      },
    ]);
    intentName = answer.name;
  }

  // Ensure intentName is defined
  if (!intentName) {
    console.log(chalk.red("❌ Error: Intent name is required."));
    process.exit(1);
  }

  // Sanitize the name for the filename
  const sanitizedName = sanitizeFileName(intentName);
  const fileName = `${sanitizedName}.oiml.yaml`;
  const filePath = join(intentsDir, fileName);

  // Check if file already exists
  if (existsSync(filePath)) {
    console.log(chalk.yellow(`⚠️  File ${fileName} already exists`));
    const { overwrite } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: "Do you want to overwrite it?",
        default: false,
      },
    ]);

    if (!overwrite) {
      console.log(chalk.gray("Cancelled."));
      process.exit(0);
    }
  }

  // Generate intent file content
  const intentContent = generateIntentTemplate(intentName);

  // Write the file
  writeFileSync(filePath, intentContent, "utf-8");

  console.log(chalk.green(`✓ Created intent file: ${fileName}`));
  console.log(chalk.gray(`  Location: ${filePath}`));
}
