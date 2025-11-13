/**
 * Generate JSON Schema files from Zod schemas
 *
 * This script reads the schema.zod.js files and generates corresponding
 * schema.json files using zod-to-json-schema.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Schema versions to generate
const schemas = [
  {
    name: "oiml.intent",
    version: "0.1.0",
    path: "../schemas/oiml.intent/0.1.0",
    schemaName: "Intent",
    title: "Open Intent Modeling Language (OIML) Intent Schema",
    description: "Schema for OIML intent definitions",
    id: "https://oiml.dev/schemas/oiml.intent/0.1.0/schema.json",
    definitions: [
      "FieldType",
      "FieldAttribute",
      "ForeignKey",
      "RelationKind",
      "ReverseRelation",
      "FieldRelation",
      "Field",
      "Provenance",
      "AIContext",
      "AddEntity",
      "AddField",
      "RemoveField",
      "AddEndpoint",
      "AddComponent",
      "AddRelation"
    ]
  },
  {
    name: "oiml.project",
    version: "0.1.0",
    path: "../schemas/oiml.project/0.1.0",
    schemaName: "Project",
    title: "Open Intent Modeling Language (OIML) Project Schema",
    description: "Schema for OIML project definitions",
    id: "https://oiml.dev/schemas/oiml.project/0.1.0/schema.json",
    definitions: [] // Project schema definitions will be auto-detected
  }
];

async function generateSchema(config) {
  console.log(`Generating JSON Schema for ${config.name}@${config.version}...`);

  // Import the Zod schema
  const schemaPath = join(__dirname, config.path, "schema.zod.js");
  const zodSchemas = await import(schemaPath);

  // Get the main schema
  const mainSchema = zodSchemas[config.schemaName];
  if (!mainSchema) {
    throw new Error(`Schema ${config.schemaName} not found in ${schemaPath}`);
  }

  // Build definitions object from config
  const definitions = {};
  if (config.definitions && config.definitions.length > 0) {
    for (const defName of config.definitions) {
      if (zodSchemas[defName]) {
        definitions[defName] = zodSchemas[defName];
      }
    }
  }

  // Convert to JSON Schema
  const converted = zodToJsonSchema(mainSchema, {
    name: config.schemaName,
    $refStrategy: "none", // Inline all definitions
    target: "jsonSchema7",
    definitions
  });

  // Build the final schema structure
  const jsonSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: config.id,
    title: config.title,
    description: config.description,
    ...converted.definitions[config.schemaName], // Expand the main schema at root
    definitions: converted.definitions // Keep all definitions
  };

  // Remove main schema from definitions since it's at root
  delete jsonSchema.definitions[config.schemaName];

  // Write to file
  const outputPath = join(__dirname, config.path, "schema.json");
  writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2) + "\n");

  console.log(`✓ Generated ${outputPath}`);
}

async function main() {
  console.log("Generating JSON Schemas from Zod definitions...\n");

  for (const schema of schemas) {
    try {
      await generateSchema(schema);
    } catch (error) {
      console.error(`✗ Failed to generate ${schema.name}@${schema.version}:`, error.message);
      process.exit(1);
    }
  }

  console.log("\n✓ All schemas generated successfully!");
}

main();
