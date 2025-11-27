import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import YAML from "yaml";
import crypto from "node:crypto";
import os from "node:os";
import type { TransformContext } from "./ir/transform/types.js";
import { transformAddEntity } from "./ir/transform/transformers/add-entity.js";
import { transformAddCapability } from "./ir/transform/transformers/add-capability.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = addFormatsModule.default || addFormatsModule;

const server = new McpServer({
  name: "oiml-mcp",
  version: "1.0.0"
});

// AJV validator cache
type Compiled = { validate: (data: any) => { ok: boolean; errors: any[] } };
const ajvCache = new Map<string, Compiled>();

/**
 * Compile AJV validator for a schema
 */
function compileAjvValidator(schemaPath: string, cacheKey: string): Compiled {
  const schemaFile = path.join(schemaPath, "schema.json");
  if (!fs.existsSync(schemaFile)) {
    throw new Error(`Schema file not found: ${schemaFile}`);
  }

  // Read schema content to generate content-based cache key
  const schemaContent = fs.readFileSync(schemaFile, "utf8");
  const schema = JSON.parse(schemaContent);

  // Generate content hash for cache invalidation when schema changes
  const contentHash = crypto.createHash("sha256").update(schemaContent).digest("hex").substring(0, 8);
  const contentBasedCacheKey = `${cacheKey}_${contentHash}`;

  const cached = ajvCache.get(contentBasedCacheKey);
  if (cached) {
    console.log(`Using cached validator: ${contentBasedCacheKey}`);
    return cached;
  }

  console.log(`Compiling validator for: ${contentBasedCacheKey}`);

  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    strictSchema: false,
    allowUnionTypes: true,
    discriminator: true
  });
  addFormats(ajv);

  const validateFn = ajv.compile(schema);
  const compiled = {
    validate: (data: unknown) => {
      const ok = !!validateFn(data);
      return { ok, errors: ok ? [] : (validateFn.errors ?? []) };
    }
  };

  ajvCache.set(contentBasedCacheKey, compiled);
  console.log(`✓ Validator compiled and cached: ${contentBasedCacheKey}`);
  return compiled;
}

/**
 * Transform a validated intent to IR
 * Returns IR object or null if transformation is not supported
 */
function transformIntentToIR(parsedContent: any, context: { projectId: string; intentId: string }): any | null {
  try {
    // Extract intents array
    const intents = parsedContent.intents || [];
    if (intents.length === 0) {
      return null;
    }

    // Transform each intent
    const transformedIntents = intents
      .map((intent: any) => {
        // Build transformation context
        const transformContext: TransformContext = {
          projectId: context.projectId,
          intentId: context.intentId,
          oimlVersion: parsedContent.version || "0.1.0",
          model: undefined
        };

        // Route to appropriate transformer based on intent kind
        switch (intent.kind) {
          case "add_entity":
            return transformAddEntity(intent, transformContext);

          case "add_capability":
            return transformAddCapability(intent, transformContext);

          // Add more transformers as they are implemented
          // case 'add_field':
          //     return IR.transformAddField(intent, transformContext);
          // case 'add_relation':
          //     return IR.transformAddRelation(intent, transformContext);

          default:
            console.log(`No IR transformer available for intent kind: ${intent.kind}`);
            return null;
        }
      })
      .filter((ir: any) => ir !== null);

    return transformedIntents.length > 0 ? transformedIntents : null;
  } catch (error) {
    console.error("Error transforming intent to IR:", error);
    return null;
  }
}

/**
 * Get schema path from @oiml/schema package
 */
function getSchemaPath(schemaName: string, version: string): string {
  console.log(`Looking for schema: ${schemaName}@${version}`);

  // Try multiple possible locations for @oiml/schema package
  // Priority: workspace source (most up-to-date) > require.resolve > node_modules
  const possiblePaths = [
    // FIRST: Check workspace source directory (most up-to-date, not published yet)
    // This ensures we use the latest schema from the monorepo source
    path.resolve(__dirname, "../../schema"),
    path.resolve(__dirname, "../../../packages/schema"),
    path.resolve(process.cwd(), "packages/schema"),
    path.resolve(process.cwd(), "../../packages/schema"),
    // SECOND: Try require.resolve (finds installed package, may be outdated)
    (() => {
      try {
        // Try resolving an exported path first
        const schemaPath = require.resolve("@oiml/schema/schemas/oiml.intent/0.1.0/schema.json");
        // Go up from schemas/oiml.intent/0.1.0/schema.json to package root
        return path.resolve(schemaPath, "../../../..");
      } catch {
        return null;
      }
    })(),
    // THIRD: Fallback to node_modules locations
    path.resolve(__dirname, "../../node_modules/@oiml/schema"),
    path.resolve(__dirname, "../../../node_modules/@oiml/schema"),
    path.resolve(process.cwd(), "node_modules/@oiml/schema")
  ].filter((p): p is string => p !== null && typeof p === "string" && p.length > 0);

  let schemaPackagePath: string | null = null;
  for (const possiblePath of possiblePaths) {
    try {
      const packageJsonPath = path.join(possiblePath, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        schemaPackagePath = possiblePath;
        console.log(`Found @oiml/schema package at: ${schemaPackagePath}`);
        break;
      }
    } catch {
      // Continue to next path
      continue;
    }
  }

  if (!schemaPackagePath) {
    throw new Error(
      `@oiml/schema package not found. ` +
        `Please ensure @oiml/schema is installed as a dependency. ` +
        `Tried paths: ${possiblePaths.join(", ")}`
    );
  }

  // Build schema path: schemas/{schemaName}/{version}/
  const schemaPath = path.join(schemaPackagePath, "schemas", schemaName, version);
  console.log(`Schema path: ${schemaPath}`);

  if (!fs.existsSync(schemaPath)) {
    // List available schemas for better error message
    const schemasDir = path.join(schemaPackagePath, "schemas");
    let availableSchemas: string[] = [];
    if (fs.existsSync(schemasDir)) {
      try {
        const schemaDirs = fs
          .readdirSync(schemasDir, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);
        availableSchemas = schemaDirs;
      } catch {
        // Ignore errors when listing
      }
    }

    throw new Error(
      `Schema ${schemaName}@${version} not found in @oiml/schema package. ` +
        `Expected path: ${schemaPath}. ` +
        (availableSchemas.length > 0
          ? `Available schemas: ${availableSchemas.join(", ")}`
          : `Schemas directory not found or empty.`)
    );
  }

  // Verify required files exist
  const requiredFiles = ["schema.json"];
  const missingFiles = requiredFiles.filter(file => !fs.existsSync(path.join(schemaPath, file)));

  if (missingFiles.length > 0) {
    throw new Error(
      `Schema ${schemaName}@${version} is incomplete. ` +
        `Missing files: ${missingFiles.join(", ")}. ` +
        `Expected location: ${schemaPath}`
    );
  }

  console.log(`✓ Using schema from @oiml/schema: ${schemaName}@${version}`);
  return schemaPath;
}

server.registerTool(
  "validate_intent",
  {
    title: "OpenIntent Validation Tool",
    description:
      "Validate an OpenIntent file against the schema from GitHub Container Registry. The schema version is read from the intent file's version field. Pass the file content as a plain string.",
    inputSchema: {
      content: z
        .string()
        .describe("Raw YAML or JSON content of the OpenIntent file as a plain string (not Anthropic message format)"),
      format: z.enum(["json", "yaml"]).describe("Format of the content (json or yaml)")
    }
  },
  async ({ content, format }: { content: string; format: "json" | "yaml" }) => {
    try {
      // Handle Anthropic message content block format if passed
      // Expected: plain string, but Cursor may wrap in [{"text": "...", "type": "text"}]
      let actualContent = content;

      // Check if content was passed as Anthropic message format
      if (typeof content === "string" && content.trim().startsWith("[{")) {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed) && parsed[0]?.text) {
            actualContent = parsed[0].text;
            console.log("Unwrapped Anthropic message format");
          }
        } catch {
          // Not JSON, use as-is
        }
      }

      // Debug logging
      console.log("=== VALIDATE_INTENT DEBUG ===");
      console.log("Content type:", typeof actualContent);
      console.log("Content length:", typeof actualContent === "string" ? actualContent.length : "N/A");
      console.log("Format:", format);
      console.log(
        "First 100 chars:",
        typeof actualContent === "string"
          ? actualContent.substring(0, 100)
          : JSON.stringify(actualContent).substring(0, 100)
      );
      console.log("=============================");

      // Parse based on format
      let parsedContent;

      if (format === "json") {
        parsedContent = JSON.parse(actualContent as string);
      } else if (format === "yaml") {
        parsedContent = YAML.parse(actualContent as string);
      } else {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                valid: false,
                errors: [`Unsupported format: ${format}. Supported formats: json, yaml`]
              })
            }
          ],
          structuredContent: {
            valid: false,
            errors: [`Unsupported format: ${format}. Supported formats: json, yaml`]
          }
        };
      }

      // Extract version from the intent file
      const schemaVersion = parsedContent?.version;
      if (!schemaVersion) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                valid: false,
                errors: [
                  'Missing "version" field in intent file. The version field is required to determine which schema to validate against.'
                ]
              })
            }
          ],
          structuredContent: {
            valid: false,
            errors: [
              'Missing "version" field in intent file. The version field is required to determine which schema to validate against.'
            ]
          }
        };
      }

      // Get pre-cached schema and validate with AJV
      const schemaName = "oiml.intent";
      const schemaPath = getSchemaPath(schemaName, schemaVersion);
      const cacheKey = `${schemaName}_${schemaVersion}`;
      const validator = compileAjvValidator(schemaPath, cacheKey);

      // Validate against the schema
      const result = validator.validate(parsedContent);

      if (result.ok) {
        // Generate a content hash for the intent ID
        const contentHash = sha256(JSON.stringify(parsedContent));
        const intentId = `sha256:${contentHash.substring(0, 16)}`;

        // Attempt to transform to IR
        const ir = transformIntentToIR(parsedContent, {
          projectId: parsedContent.project || "unknown",
          intentId
        });

        const response = {
          valid: true,
          message: `File is valid according to OIML Intent Schema v${schemaVersion}`,
          schemaVersion,
          ir: ir || undefined, // Include IR if transformation succeeded
          irAvailable: ir !== null,
          intentId
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2)
            }
          ],
          structuredContent: response
        };
      } else {
        const errors = result.errors.map((err: any) => {
          const path = err.instancePath || "/";
          return `${path}: ${err.message}`;
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  valid: false,
                  errors,
                  schemaVersion
                },
                null,
                2
              )
            }
          ],
          structuredContent: {
            valid: false,
            errors,
            schemaVersion
          }
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              valid: false,
              errors: [`Error: ${errorMessage}`]
            })
          }
        ],
        structuredContent: {
          valid: false,
          errors: [`Error: ${errorMessage}`]
        }
      };
    }
  }
);

server.registerTool(
  "validate_project",
  {
    title: "OpenIntent Project Configuration Validation Tool",
    description:
      "Validate a project.yaml file against the OpenIntent project schema from GitHub Container Registry. The schema version is read from the project file's version field. Pass the file content directly along with its format.",
    inputSchema: {
      content: z.string().describe("Raw content of the project.yaml file"),
      format: z.enum(["json", "yaml"]).describe("Format of the content (json or yaml)")
    }
  },
  async ({ content, format }: { content: string; format: "json" | "yaml" }) => {
    try {
      // Handle Anthropic message content block format if passed
      // Expected: plain string, but Cursor may wrap in [{"text": "...", "type": "text"}]
      let actualContent = content;

      // Check if content was passed as Anthropic message format
      if (typeof content === "string" && content.trim().startsWith("[{")) {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed) && parsed[0]?.text) {
            actualContent = parsed[0].text;
            console.log("Unwrapped Anthropic message format");
          }
        } catch {
          // Not JSON, use as-is
        }
      }

      // Parse based on format
      let parsedContent;
      try {
        if (format === "json") {
          parsedContent = JSON.parse(actualContent);
        } else if (format === "yaml") {
          parsedContent = YAML.parse(actualContent);
        } else {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  valid: false,
                  errors: [`Unsupported format: ${format}. Supported formats: json, yaml`]
                })
              }
            ],
            structuredContent: {
              valid: false,
              errors: [`Unsupported format: ${format}. Supported formats: json, yaml`]
            }
          };
        }
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : "Unknown parse error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                valid: false,
                errors: [`Parse error: ${errorMessage}`]
              })
            }
          ],
          structuredContent: {
            valid: false,
            errors: [`Parse error: ${errorMessage}`]
          }
        };
      }

      // Extract version from the project file
      const schemaVersion = parsedContent?.version;
      if (!schemaVersion) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                valid: false,
                errors: [
                  'Missing "version" field in project file. The version field is required to determine which schema to validate against.'
                ]
              })
            }
          ],
          structuredContent: {
            valid: false,
            errors: [
              'Missing "version" field in project file. The version field is required to determine which schema to validate against.'
            ]
          }
        };
      }

      // Get pre-cached schema and validate with AJV
      const schemaName = "oiml.project";
      const schemaPath = getSchemaPath(schemaName, schemaVersion);
      const cacheKey = `${schemaName}_${schemaVersion}`;
      const validator = compileAjvValidator(schemaPath, cacheKey);

      // Validate against the schema
      const result = validator.validate(parsedContent);

      if (result.ok) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  valid: true,
                  message: `File is valid according to OIML Project Schema v${schemaVersion}`,
                  schemaVersion
                },
                null,
                2
              )
            }
          ],
          structuredContent: {
            valid: true,
            schemaVersion
          }
        };
      } else {
        const errors = result.errors.map((err: any) => {
          const path = err.instancePath || "/";
          return `${path}: ${err.message}`;
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  valid: false,
                  errors,
                  schemaVersion
                },
                null,
                2
              )
            }
          ],
          structuredContent: {
            valid: false,
            errors,
            schemaVersion
          }
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              valid: false,
              errors: [`Validation error: ${errorMessage}`]
            })
          }
        ],
        structuredContent: {
          valid: false,
          errors: [`Validation error: ${errorMessage}`]
        }
      };
    }
  }
);

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

server.registerTool(
  "transform_to_ir",
  {
    title: "Transform Intent to IR",
    description:
      "Transform a validated OIML intent to its Intermediate Representation (IR) for code generation. The intent must be valid according to the OIML schema. Returns machine-friendly IR with resolved types, inferred values, and diagnostics.",
    inputSchema: {
      content: z.string().describe("Raw YAML or JSON content of the validated OpenIntent file"),
      format: z.enum(["json", "yaml"]).describe("Format of the content (json or yaml)"),
      projectId: z.string().optional().describe("Optional project ID for provenance tracking"),
      intentId: z.string().optional().describe("Optional intent ID for provenance tracking")
    }
  },
  async ({
    content,
    format,
    projectId,
    intentId
  }: {
    content: string;
    format: "json" | "yaml";
    projectId?: string;
    intentId?: string;
  }) => {
    try {
      // Handle Anthropic message content block format if passed
      let actualContent = content;
      if (typeof content === "string" && content.trim().startsWith("[{")) {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed) && parsed[0]?.text) {
            actualContent = parsed[0].text;
          }
        } catch {
          // Not JSON, use as-is
        }
      }

      // Parse based on format
      let parsedContent;
      try {
        if (format === "json") {
          parsedContent = JSON.parse(actualContent as string);
        } else if (format === "yaml") {
          parsedContent = YAML.parse(actualContent as string);
        } else {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Unsupported format: ${format}. Supported formats: json, yaml`
                })
              }
            ],
            structuredContent: {
              success: false,
              error: `Unsupported format: ${format}. Supported formats: json, yaml`
            }
          };
        }
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : "Unknown parse error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Parse error: ${errorMessage}`
              })
            }
          ],
          structuredContent: {
            success: false,
            error: `Parse error: ${errorMessage}`
          }
        };
      }

      // Generate IDs if not provided
      const contentHash = sha256(JSON.stringify(parsedContent));
      const finalProjectId = projectId || parsedContent.project || "unknown";
      const finalIntentId = intentId || `sha256:${contentHash.substring(0, 16)}`;

      // Transform to IR
      const ir = transformIntentToIR(parsedContent, {
        projectId: finalProjectId,
        intentId: finalIntentId
      });

      if (!ir) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "No IR transformation available for the given intent(s). Supported kinds: add_entity",
                  version: parsedContent.version,
                  intentKinds: (parsedContent.intents || []).map((i: any) => i.kind)
                },
                null,
                2
              )
            }
          ],
          structuredContent: {
            success: false,
            error: "No IR transformation available",
            supportedKinds: ["add_entity"]
          }
        };
      }

      const response = {
        success: true,
        ir,
        metadata: {
          version: parsedContent.version || "0.1.0",
          projectId: finalProjectId,
          intentId: finalIntentId,
          transformedIntents: ir.length,
          timestamp: new Date().toISOString()
        }
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2)
          }
        ],
        structuredContent: response
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("Error transforming to IR:", error);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Transformation error: ${errorMessage}`
            })
          }
        ],
        structuredContent: {
          success: false,
          error: `Transformation error: ${errorMessage}`
        }
      };
    }
  }
);

// Flexible project path resolution
function findProjectPath(): string {
  // First, try environment variable
  if (process.env.OI_PROJECT_PATH) {
    return process.env.OI_PROJECT_PATH;
  }

  // Then try OI_REPO_ROOT with .openintent/project.yaml
  if (process.env.OI_REPO_ROOT) {
    const projectPath = path.join(process.env.OI_REPO_ROOT, ".openintent/project.yaml");
    if (fs.existsSync(projectPath)) {
      return projectPath;
    }
  }

  // Search current directory and parent directories for .openintent/project.yaml
  let currentDir = process.cwd();
  while (currentDir !== path.dirname(currentDir)) {
    const projectPath = path.join(currentDir, ".openintent/project.yaml");
    if (fs.existsSync(projectPath)) {
      return projectPath;
    }
    currentDir = path.dirname(currentDir);
  }

  // Fallback to current directory
  return path.join(process.cwd(), ".openintent/project.yaml");
}

// Compatibility matrix for template resolution
interface CompatibilityEntry {
  framework: string;
  category: string;
  versions: Array<{
    template_version: string;
    pack_name: string;
    compat: Record<string, string>;
    breaking_changes: string[];
  }>;
}

/**
 * Load compatibility matrix from compatibility/matrix.json (in oiml-mcp folder)
 */
function loadCompatibilityMatrix(): CompatibilityEntry[] {
  // Try multiple possible locations for the matrix
  const possiblePaths = [
    path.join("/app", "compatibility", "matrix.json"), // Docker container location
    path.join(__dirname, "../compatibility/matrix.json"), // Local compatibility directory (from dist/)
    path.join(__dirname, "../../compatibility/matrix.json"), // Local compatibility directory (from src/)
    path.join(process.cwd(), "compatibility/matrix.json"), // Current working directory
    // Legacy paths for backward compatibility
    path.join(__dirname, "../../packages/schema/compatibility/matrix.json"),
    path.join(__dirname, "../../../packages/schema/compatibility/matrix.json"),
    path.join(process.cwd(), "../packages/schema/compatibility/matrix.json")
  ];

  for (const matrixPath of possiblePaths) {
    if (fs.existsSync(matrixPath)) {
      console.log(`Loading compatibility matrix from: ${matrixPath}`);
      const content = fs.readFileSync(matrixPath, "utf8");
      return JSON.parse(content);
    }
  }

  console.warn("⚠ Warning: Compatibility matrix not found at any expected location");
  return [];
}

/**
 * Check if a version satisfies a semver range
 * Simple implementation - supports: >=x.y.z <a.b.c patterns
 */
function satisfiesRange(version: string, range: string): boolean {
  const [gtePart, ltPart] = range.split(" ");

  const parseVersion = (v: string) => v.split(".").map(Number);
  const versionParts = parseVersion(version);

  // Check >= constraint
  if (gtePart?.startsWith(">=")) {
    const minVersion = parseVersion(gtePart.slice(2));
    for (let i = 0; i < 3; i++) {
      if (versionParts[i] < minVersion[i]) return false;
      if (versionParts[i] > minVersion[i]) break;
    }
  }

  // Check < constraint
  if (ltPart?.startsWith("<")) {
    const maxVersion = parseVersion(ltPart.slice(1));
    let isLessThan = false;
    for (let i = 0; i < 3; i++) {
      if (versionParts[i] < maxVersion[i]) {
        isLessThan = true;
        break; // version < maxVersion, satisfies constraint
      }
      if (versionParts[i] > maxVersion[i]) {
        return false; // version > maxVersion, doesn't satisfy
      }
      // If equal, continue to next part
    }
    // If all parts are equal, version === maxVersion, doesn't satisfy <
    if (!isLessThan) return false;
  }

  return true;
}

server.registerTool(
  "resolve_template",
  {
    title: "Resolve Template Pack for Framework",
    description:
      "Resolve the appropriate template pack for a framework based on intent schema version and framework versions. Returns the template pack URI, digest, and compatibility information.",
    inputSchema: {
      intent_schema_version: z.string().describe('OIML intent schema version (e.g., "0.1.0")'),
      framework: z.string().describe('Framework name (e.g., "prisma", "next", "express")'),
      framework_version: z.string().describe('Installed framework version (e.g., "6.19.0", "15.0.0")'),
      category: z.enum(["database", "api", "ui"]).optional().describe("Framework category (optional, can be inferred)")
    }
  },
  async ({
    intent_schema_version,
    framework,
    framework_version,
    category
  }: {
    intent_schema_version: string;
    framework: string;
    framework_version: string;
    category?: "database" | "api" | "ui";
  }) => {
    try {
      console.log(`Resolving template for: ${framework}@${framework_version}, OIML ${intent_schema_version}`);

      const matrix = loadCompatibilityMatrix();

      // Find the framework entry
      const frameworkEntry = matrix.find(
        entry => entry.framework === framework && (!category || entry.category === category)
      );

      if (!frameworkEntry) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  compatible: false,
                  error: `Framework "${framework}" not found in compatibility matrix`,
                  available_frameworks: matrix.map(e => e.framework)
                },
                null,
                2
              )
            }
          ],
          structuredContent: {
            compatible: false,
            error: `Framework "${framework}" not found in compatibility matrix`,
            available_frameworks: matrix.map(e => e.framework)
          }
        };
      }

      // Find compatible template version (prefer latest compatible)
      const compatibleVersions = frameworkEntry.versions.filter(v => {
        const oimlCompatible = satisfiesRange(intent_schema_version, v.compat.oiml);
        const frameworkCompatible = satisfiesRange(framework_version, v.compat[framework] || ">=0.0.0");
        return oimlCompatible && frameworkCompatible;
      });

      if (compatibleVersions.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  compatible: false,
                  error: `No compatible template found for ${framework}@${framework_version} with OIML ${intent_schema_version}`,
                  framework: framework,
                  framework_version: framework_version,
                  intent_schema_version: intent_schema_version,
                  available_template_versions: frameworkEntry.versions.map(v => ({
                    version: v.template_version,
                    compat: v.compat
                  }))
                },
                null,
                2
              )
            }
          ],
          structuredContent: {
            compatible: false,
            error: `No compatible template found`,
            available_template_versions: frameworkEntry.versions.map(v => ({
              version: v.template_version,
              compat: v.compat
            }))
          }
        };
      }

      // Use the latest compatible version
      const template = compatibleVersions[compatibleVersions.length - 1];

      // Generate pack URI and digest
      const packUri = `oiml://compat/${template.pack_name}/${template.template_version}`;
      const digest = crypto.createHash("sha256").update(JSON.stringify(template)).digest("hex");

      const result = {
        compatible: true,
        framework: frameworkEntry.framework,
        category: frameworkEntry.category,
        template_pack: packUri,
        template_version: template.template_version,
        digest: `sha256-${digest}`,
        compat: template.compat,
        breaking_changes: template.breaking_changes,
        message: `Compatible template found: ${template.pack_name}@${template.template_version}`
      };

      console.log(`✓ Resolved template: ${packUri}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ],
        structuredContent: result
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error(`Error resolving template: ${errorMessage}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                compatible: false,
                error: errorMessage
              },
              null,
              2
            )
          }
        ],
        structuredContent: {
          compatible: false,
          error: errorMessage
        }
      };
    }
  }
);

server.registerTool(
  "get_agents_guide",
  {
    title: "Get OIML Agents Implementation Guide",
    description:
      "Returns the OIML Agents implementation guide (AGENTS.md) that provides complete reference for implementing OIML-based code generation. This guide contains workflow instructions, framework-specific patterns, and best practices for applying intents.",
    inputSchema: {}
  },
  async () => {
    try {
      // Get current file directory - use __dirname if available (CommonJS), otherwise use import.meta.url (ES modules)
      const currentDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));

      const cwd = process.cwd();

      // Try multiple possible locations for AGENTS.md
      // Priority order: Docker container -> built dist -> source -> cwd-based -> absolute dev path
      const possiblePaths = [
        // Docker container location (highest priority for deployed environments)
        "/app/assets/AGENTS.md",
        // Built package locations (when running from dist/)
        path.join(currentDir, "../assets/AGENTS.md"), // dist/assets/AGENTS.md
        path.join(currentDir, "../../assets/AGENTS.md"), // Alternative built location
        // Source locations (when running from src/ in development)
        path.join(currentDir, "../../assets/AGENTS.md"), // src/../../assets/AGENTS.md
        // Current working directory based
        path.join(cwd, "assets/AGENTS.md"), // Current directory
        path.join(cwd, "../assets/AGENTS.md"), // Parent directory
        path.join(cwd, "../../oiml-mcp/assets/AGENTS.md"), // Workspace location
        path.join(cwd, "oiml-mcp/assets/AGENTS.md") // Alternative workspace location
      ];

      // Remove duplicates (using normalized paths)
      const normalizedPaths = possiblePaths.map(p => {
        try {
          return path.normalize(p);
        } catch {
          return p;
        }
      });
      const uniquePaths = Array.from(new Set(normalizedPaths));

      let agentsPath: string | null = null;
      for (const possiblePath of uniquePaths) {
        try {
          if (fs.existsSync(possiblePath)) {
            agentsPath = possiblePath;
            console.log(`Found AGENTS.md at: ${agentsPath}`);
            break;
          }
        } catch (err) {
          // Skip paths that cause errors (e.g., permission issues)
          continue;
        }
      }

      if (!agentsPath) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "AGENTS.md file not found in any expected location",
                searched_paths: possiblePaths
              })
            }
          ],
          structuredContent: {
            success: false,
            error: "AGENTS.md file not found"
          }
        };
      }

      const content = fs.readFileSync(agentsPath, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: content
          }
        ],
        structuredContent: {
          success: true,
          content,
          path: agentsPath,
          size: content.length
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error(`Error reading AGENTS.md: ${errorMessage}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Error reading AGENTS.md: ${errorMessage}`
            })
          }
        ],
        structuredContent: {
          success: false,
          error: errorMessage
        }
      };
    }
  }
);

server.registerTool(
  "validate_plan",
  {
    title: "Validate Implementation Plan",
    description:
      "Validate a plan.yaml file against the OIML plan schema from GitHub Container Registry. The schema version is read from the plan file's version field. Pass the file content as a plain string. String arrays (mitigations, factors, warnings) can contain formatted text with parentheses or other characters - they will be automatically normalized.",
    inputSchema: {
      content: z.string().describe("Raw YAML or JSON content of the plan file as a plain string"),
      format: z.enum(["json", "yaml"]).describe("Format of the content (json or yaml)")
    }
  },
  async ({ content, format }: { content: string; format: "json" | "yaml" }) => {
    try {
      // Handle Anthropic message content block format if passed
      let actualContent = content;
      if (typeof content === "string" && content.trim().startsWith("[{")) {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed) && parsed[0]?.text) {
            actualContent = parsed[0].text;
            console.log("Unwrapped Anthropic message format");
          }
        } catch {
          // Not JSON, use as-is
        }
      }

      // Parse based on format
      let parsedContent;
      try {
        if (format === "json") {
          parsedContent = JSON.parse(actualContent);
        } else if (format === "yaml") {
          parsedContent = YAML.parse(actualContent);
        } else {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  valid: false,
                  errors: [`Unsupported format: ${format}. Supported formats: json, yaml`]
                })
              }
            ],
            structuredContent: {
              valid: false,
              errors: [`Unsupported format: ${format}. Supported formats: json, yaml`]
            }
          };
        }
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : "Unknown parse error";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                valid: false,
                errors: [`Parse error: ${errorMessage}`]
              })
            }
          ],
          structuredContent: {
            valid: false,
            errors: [`Parse error: ${errorMessage}`]
          }
        };
      }

      // Normalize string arrays to handle formatted strings (with parentheses, etc.)
      // This ensures YAML parsing quirks don't cause validation failures
      const normalizeStringArrays = (obj: any, paths: string[]): any => {
        if (!obj || typeof obj !== "object") return obj;

        const result = Array.isArray(obj) ? [...obj] : { ...obj };

        for (const [key, value] of Object.entries(result)) {
          const currentPath = `${key}`;

          // If this is an array that should contain only strings, ensure all elements are strings
          if (Array.isArray(value) && paths.some(p => p === currentPath)) {
            result[key] = value.map((item: any) => {
              if (typeof item === "string") return item;
              if (item === null || item === undefined) return "";
              return String(item);
            });
          } else if (value && typeof value === "object") {
            result[key] = normalizeStringArrays(value, paths);
          }
        }

        return result;
      };

      // Apply normalization to known string array fields in plan schema
      const stringArrayFields = ["mitigations", "factors", "warnings"];
      parsedContent = normalizeStringArrays(parsedContent, stringArrayFields);

      // Extract version from the plan file
      const schemaVersion = parsedContent?.version;
      if (!schemaVersion) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                valid: false,
                errors: [
                  'Missing "version" field in plan file. The version field is required to determine which schema to validate against.'
                ]
              })
            }
          ],
          structuredContent: {
            valid: false,
            errors: [
              'Missing "version" field in plan file. The version field is required to determine which schema to validate against.'
            ]
          }
        };
      }

      // Get pre-cached schema and validate with AJV
      const schemaName = "oiml.plan";
      const schemaPath = getSchemaPath(schemaName, schemaVersion);
      const cacheKey = `${schemaName}_${schemaVersion}`;
      const validator = compileAjvValidator(schemaPath, cacheKey);

      // Validate against the schema
      const result = validator.validate(parsedContent);

      if (result.ok) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  valid: true,
                  message: `Plan is valid according to OIML Implementation Plan Schema v${schemaVersion}`,
                  schemaVersion,
                  plan: {
                    intent_id: parsedContent.intent_id,
                    intents_to_process: parsedContent.intents_to_process,
                    template: parsedContent.template_used,
                    steps: parsedContent.steps?.length || 0,
                    planned_changes: parsedContent.planned_changes?.length || 0,
                    risk_level: parsedContent.risk_assessment?.level || "not_assessed"
                  }
                },
                null,
                2
              )
            }
          ],
          structuredContent: {
            valid: true,
            schemaVersion,
            plan: {
              intent_id: parsedContent.intent_id,
              intents_to_process: parsedContent.intents_to_process,
              steps: parsedContent.steps?.length || 0,
              planned_changes: parsedContent.planned_changes?.length || 0
            }
          }
        };
      } else {
        const errors = result.errors.map((err: any) => {
          const path = err.instancePath || "/";
          return `${path}: ${err.message}`;
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  valid: false,
                  errors,
                  schemaVersion,
                  message: "Plan validation failed"
                },
                null,
                2
              )
            }
          ],
          structuredContent: {
            valid: false,
            errors,
            schemaVersion
          }
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              valid: false,
              errors: [`Validation error: ${errorMessage}`]
            })
          }
        ],
        structuredContent: {
          valid: false,
          errors: [`Validation error: ${errorMessage}`]
        }
      };
    }
  }
);

// Set up Express and HTTP transport
const app = express();
app.use(express.json());

// Health check endpoint for Docker and load balancers
app.get("/health", (req: Request, res: Response) => {
  // Try to get schema package info
  let schemaInfo = {
    package: "@oiml/schema",
    found: false,
    schemas: 0
  };

  try {
    const possiblePaths = [
      path.resolve(__dirname, "../../node_modules/@oiml/schema"),
      path.resolve(__dirname, "../../../node_modules/@oiml/schema"),
      path.resolve(__dirname, "../../schema"),
      path.resolve(process.cwd(), "node_modules/@oiml/schema"),
      path.resolve(process.cwd(), "../../packages/schema")
    ];

    for (const possiblePath of possiblePaths) {
      const schemasDir = path.join(possiblePath, "schemas");
      if (fs.existsSync(schemasDir)) {
        schemaInfo.found = true;
        const schemaDirs = fs
          .readdirSync(schemasDir, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);
        schemaInfo.schemas = schemaDirs.length;
        break;
      }
    }
  } catch {
    // Ignore errors in health check
  }

  res.status(200).json({
    status: "healthy",
    service: "oiml-mcp",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    schemaPackage: schemaInfo
  });
});

// Root endpoint with service info
app.get("/", (req: Request, res: Response) => {
  res.json({
    service: "OpenIntent MCP Server",
    version: "1.0.0",
    description: "Model Context Protocol server for OpenIntent validation and generation",
    endpoints: {
      mcp: "/mcp",
      health: "/health"
    },
    documentation: "https://github.com/openintent/oiml"
  });
});

// MCP endpoint
app.post("/mcp", async (req: Request, res: Response) => {
  // Create a new transport for each request to prevent request ID collisions
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

/**
 * Start the MCP server on the specified port
 */
export function startServer(port: number = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    app
      .listen(port, () => {
        console.log(`OpenIntent MCP Server running on http://localhost:${port}`);
        console.log(`  - Health check: http://localhost:${port}/health`);
        console.log(`  - MCP endpoint: http://localhost:${port}/mcp`);
        console.log(`  - Schema package: @oiml/schema`);
        resolve();
      })
      .on("error", (error: Error) => {
        console.error("Server error:", error);
        reject(error);
      });
  });
}

// Only start server automatically if this file is run directly (not imported)
// In ES modules, check if this file is being executed directly
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("server.js") ||
  process.argv[1]?.endsWith("server.ts") ||
  process.argv[1]?.includes("server.js") ||
  process.argv[1]?.includes("server.ts");

if (isMainModule) {
  // Use PORT from environment or default to 3000 (changed from 4000 for container deployments)
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  startServer(port).catch((error: Error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
