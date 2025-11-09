import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import crypto from "node:crypto";
import os from "node:os";

const server = new McpServer({
    name: 'oiml-mcp',
    version: '1.0.0'
});

// Schema cache directory (use env var or default)
const SCHEMA_CACHE_DIR = process.env.SCHEMA_CACHE_DIR || path.join(os.homedir(), '.openintent', 'schema-cache');

console.log(`Schema cache directory: ${SCHEMA_CACHE_DIR}`);

// Verify cache directory exists (it should be pre-populated in Docker builds)
if (!fs.existsSync(SCHEMA_CACHE_DIR)) {
    console.warn(`⚠ Warning: Schema cache directory not found: ${SCHEMA_CACHE_DIR}`);
    console.warn(`  Schemas must be pre-cached at build time for validation to work.`);
    console.warn(`  See Dockerfile for schema pre-caching configuration.`);
}

// AJV validator cache
type Compiled = { validate: (data: any) => { ok: boolean; errors: any[] } };
const ajvCache = new Map<string, Compiled>();

/**
 * Compile AJV validator for a schema
 */
function compileAjvValidator(schemaPath: string, cacheKey: string): Compiled {
    const cached = ajvCache.get(cacheKey);
    if (cached) {
        console.log(`Using cached validator: ${cacheKey}`);
        return cached;
    }

    console.log(`Compiling validator for: ${cacheKey}`);
    
    const schemaFile = path.join(schemaPath, 'schema.json');
    if (!fs.existsSync(schemaFile)) {
        throw new Error(`Schema file not found: ${schemaFile}`);
    }
    
    const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
    
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
    
    ajvCache.set(cacheKey, compiled);
    console.log(`✓ Validator compiled and cached: ${cacheKey}`);
    return compiled;
}

/**
 * Get schema from pre-cached directory
 */
function getSchemaPath(schemaName: string, version: string): string {
    const cacheKey = `${schemaName}_${version}`;
    const cachePath = path.join(SCHEMA_CACHE_DIR, cacheKey);
    
    console.log(`Looking for pre-cached schema: ${schemaName}@${version}`);
    console.log(`Expected path: ${cachePath}`);
    
    if (!fs.existsSync(cachePath)) {
        console.error(`❌ Schema not found in cache: ${schemaName}@${version}`);
        console.error(`Available schemas in cache:`);
        
        if (fs.existsSync(SCHEMA_CACHE_DIR)) {
            const cachedSchemas = fs.readdirSync(SCHEMA_CACHE_DIR);
            if (cachedSchemas.length === 0) {
                console.error(`  (none - cache is empty)`);
            } else {
                cachedSchemas.forEach(schema => console.error(`  - ${schema}`));
            }
        } else {
            console.error(`  (cache directory does not exist)`);
        }
        
        throw new Error(
            `Schema ${schemaName}@${version} not found in pre-cached schemas. ` +
            `Schemas must be bundled at Docker build time. ` +
            `See Dockerfile for adding schema versions.`
        );
    }
    
    // Verify required files exist
    const requiredFiles = ['schema.json'];
    const missingFiles = requiredFiles.filter(file => !fs.existsSync(path.join(cachePath, file)));
    
    if (missingFiles.length > 0) {
        throw new Error(
            `Pre-cached schema ${schemaName}@${version} is incomplete. ` +
            `Missing files: ${missingFiles.join(', ')}. ` +
            `Rebuild the Docker image to fix this issue.`
        );
    }
    
    console.log(`✓ Using pre-cached schema: ${schemaName}@${version}`);
    return cachePath;
}

server.registerTool(
    'validate_intent',
    {
        title: 'OpenIntent Validation Tool',
        description: 'Validate an OpenIntent file against the schema from GitHub Container Registry. The schema version is read from the intent file\'s version field. Pass the file content directly along with its format.',
        inputSchema: { 
            content: z.string().describe('Raw content of the OpenIntent file'),
            format: z.enum(['json', 'yaml']).describe('Format of the content (json or yaml)')
        }
    },
    async ({ content, format }) => {
        try {
            // Debug logging to see what we receive
            console.log('=== VALIDATE_INTENT DEBUG ===');
            console.log('Content type:', typeof content);
            console.log('Content length:', typeof content === 'string' ? content.length : 'N/A');
            console.log('Format:', format);
            console.log('First 100 chars of content:', typeof content === 'string' ? content.substring(0, 100) : JSON.stringify(content).substring(0, 100));
            console.log('=============================');
            
            // Parse based on format
            let parsedContent;
            
            if (format === 'json') {
                parsedContent = JSON.parse(content as string);
            } else if (format === 'yaml') {
                parsedContent = YAML.parse(content as string);
            } else {
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors: [`Unsupported format: ${format}. Supported formats: json, yaml`] 
                        }) 
                    }],
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
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors: ['Missing "version" field in intent file. The version field is required to determine which schema to validate against.'] 
                        }) 
                    }],
                    structuredContent: { 
                        valid: false, 
                        errors: ['Missing "version" field in intent file. The version field is required to determine which schema to validate against.'] 
                    }
                };
            }

            // Get pre-cached schema and validate with AJV
            const schemaName = 'oiml.intent';
            const schemaPath = getSchemaPath(schemaName, schemaVersion);
            const cacheKey = `${schemaName}_${schemaVersion}`;
            const validator = compileAjvValidator(schemaPath, cacheKey);

            // Validate against the schema
            const result = validator.validate(parsedContent);
            
            if (result.ok) {
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: true,
                            message: `File is valid according to OIML Intent Schema v${schemaVersion}`,
                            schemaVersion
                        }, null, 2) 
                    }],
                    structuredContent: { 
                        valid: true,
                        schemaVersion 
                    }
                };
            } else {
                const errors = result.errors.map((err: any) => {
                    const path = err.instancePath || '/';
                    return `${path}: ${err.message}`;
                });
                
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors,
                            schemaVersion 
                        }, null, 2) 
                    }],
                    structuredContent: { 
                        valid: false, 
                        errors,
                        schemaVersion 
                    }
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return {
                content: [{ 
                    type: 'text', 
                    text: JSON.stringify({ 
                        valid: false, 
                        errors: [`Error: ${errorMessage}`] 
                    }) 
                }],
                structuredContent: { 
                    valid: false, 
                    errors: [`Error: ${errorMessage}`] 
                }
            };
        }
    }
);

server.registerTool(
    'manage_schema_cache',
    {
        title: 'Manage Schema Cache',
        description: 'List, clear, or refresh cached schemas from GitHub Container Registry',
        inputSchema: { 
            action: z.enum(['list', 'clear', 'clear-all']).describe('Action to perform: list (show cached schemas), clear (remove specific schema), clear-all (remove all cached schemas)'),
            schemaName: z.string().optional().describe('Schema name (required for clear action)'),
            schemaVersion: z.string().optional().describe('Schema version (required for clear action)')
        },
        outputSchema: { 
            success: z.boolean(),
            message: z.string(),
            cached_schemas: z.array(z.object({
                name: z.string(),
                version: z.string(),
                path: z.string(),
                size: z.string()
            })).optional()
        }
    },
    async ({ action, schemaName, schemaVersion }) => {
        try {
            if (action === 'list') {
                // List all cached schemas
                if (!fs.existsSync(SCHEMA_CACHE_DIR)) {
                    return {
                        content: [{ 
                            type: 'text', 
                            text: JSON.stringify({ 
                                success: true,
                                message: 'No schemas cached yet',
                                cached_schemas: []
                            }, null, 2) 
                        }],
                        structuredContent: { 
                            success: true,
                            message: 'No schemas cached yet',
                            cached_schemas: []
                        }
                    };
                }
                
                const entries = fs.readdirSync(SCHEMA_CACHE_DIR);
                const schemas = entries.map(entry => {
                    const [name, version] = entry.split('_');
                    const schemaPath = path.join(SCHEMA_CACHE_DIR, entry);
                    
                    // Calculate directory size
                    let size = 0;
                    const files = fs.readdirSync(schemaPath);
                    files.forEach(file => {
                        const stats = fs.statSync(path.join(schemaPath, file));
                        size += stats.size;
                    });
                    
                    return {
                        name: name || entry,
                        version: version || 'unknown',
                        path: schemaPath,
                        size: `${(size / 1024).toFixed(2)} KB`
                    };
                });
                
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            success: true,
                            message: `Found ${schemas.length} cached schema(s)`,
                            cached_schemas: schemas
                        }, null, 2) 
                    }],
                    structuredContent: { 
                        success: true,
                        message: `Found ${schemas.length} cached schema(s)`,
                        cached_schemas: schemas
                    }
                };
            } else if (action === 'clear') {
                // Clear specific schema
                if (!schemaName || !schemaVersion) {
                    return {
                        content: [{ 
                            type: 'text', 
                            text: JSON.stringify({ 
                                success: false,
                                message: 'schemaName and schemaVersion are required for clear action'
                            }) 
                        }],
                        structuredContent: { 
                            success: false,
                            message: 'schemaName and schemaVersion are required for clear action'
                        }
                    };
                }
                
                const cacheKey = `${schemaName}_${schemaVersion}`;
                const cachePath = path.join(SCHEMA_CACHE_DIR, cacheKey);
                
                if (!fs.existsSync(cachePath)) {
                    return {
                        content: [{ 
                            type: 'text', 
                            text: JSON.stringify({ 
                                success: false,
                                message: `Schema not found in cache: ${schemaName}@${schemaVersion}`
                            }) 
                        }],
                        structuredContent: { 
                            success: false,
                            message: `Schema not found in cache: ${schemaName}@${schemaVersion}`
                        }
                    };
                }
                
                fs.rmSync(cachePath, { recursive: true, force: true });
                
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            success: true,
                            message: `Cleared cached schema: ${schemaName}@${schemaVersion}`
                        }) 
                    }],
                    structuredContent: { 
                        success: true,
                        message: `Cleared cached schema: ${schemaName}@${schemaVersion}`
                    }
                };
            } else if (action === 'clear-all') {
                // Clear all cached schemas
                if (fs.existsSync(SCHEMA_CACHE_DIR)) {
                    fs.rmSync(SCHEMA_CACHE_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SCHEMA_CACHE_DIR, { recursive: true });
                }
                
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            success: true,
                            message: 'All cached schemas cleared'
                        }) 
                    }],
                    structuredContent: { 
                        success: true,
                        message: 'All cached schemas cleared'
                    }
                };
            }
            
            return {
                content: [{ 
                    type: 'text', 
                    text: JSON.stringify({ 
                        success: false,
                        message: 'Invalid action'
                    }) 
                }],
                structuredContent: { 
                    success: false,
                    message: 'Invalid action'
                }
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return {
                content: [{ 
                    type: 'text', 
                    text: JSON.stringify({ 
                        success: false,
                        message: `Error: ${errorMessage}`
                    }) 
                }],
                structuredContent: { 
                    success: false,
                    message: `Error: ${errorMessage}`
                }
            };
        }
    }
);

server.registerTool(
    'validate_project',
    {
        title: 'OpenIntent Project Configuration Validation Tool',
        description: 'Validate a project.yaml file against the OpenIntent project schema from GitHub Container Registry. The schema version is read from the project file\'s version field. Pass the file content directly along with its format.',
        inputSchema: { 
            content: z.string().describe('Raw content of the project.yaml file'),
            format: z.enum(['json', 'yaml']).describe('Format of the content (json or yaml)')
        }
    },
    async ({ content, format }) => {
        try {
            // Parse based on format
            let parsedContent;
            try {
                if (format === 'json') {
                    parsedContent = JSON.parse(content);
                } else if (format === 'yaml') {
                    parsedContent = YAML.parse(content);
                } else {
                    return {
                        content: [{ 
                            type: 'text', 
                            text: JSON.stringify({ 
                                valid: false, 
                                errors: [`Unsupported format: ${format}. Supported formats: json, yaml`] 
                            }) 
                        }],
                        structuredContent: { 
                            valid: false, 
                            errors: [`Unsupported format: ${format}. Supported formats: json, yaml`] 
                        }
                    };
                }
            } catch (parseError) {
                const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parse error';
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors: [`Parse error: ${errorMessage}`] 
                        }) 
                    }],
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
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors: ['Missing "version" field in project file. The version field is required to determine which schema to validate against.'] 
                        }) 
                    }],
                    structuredContent: { 
                        valid: false, 
                        errors: ['Missing "version" field in project file. The version field is required to determine which schema to validate against.'] 
                    }
                };
            }

            // Get pre-cached schema and validate with AJV
            const schemaName = 'oiml.project';
            const schemaPath = getSchemaPath(schemaName, schemaVersion);
            const cacheKey = `${schemaName}_${schemaVersion}`;
            const validator = compileAjvValidator(schemaPath, cacheKey);

            // Validate against the schema
            const result = validator.validate(parsedContent);
            
            if (result.ok) {
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: true,
                            message: `File is valid according to OIML Project Schema v${schemaVersion}`,
                            schemaVersion
                        }, null, 2) 
                    }],
                    structuredContent: { 
                        valid: true,
                        schemaVersion 
                    }
                };
            } else {
                const errors = result.errors.map((err: any) => {
                    const path = err.instancePath || '/';
                    return `${path}: ${err.message}`;
                });
                
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors,
                            schemaVersion 
                        }, null, 2) 
                    }],
                    structuredContent: { 
                        valid: false, 
                        errors,
                        schemaVersion 
                    }
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return {
                content: [{ 
                    type: 'text', 
                    text: JSON.stringify({ 
                        valid: false, 
                        errors: [`Validation error: ${errorMessage}`] 
                    }) 
                }],
                structuredContent: { 
                    valid: false, 
                    errors: [`Validation error: ${errorMessage}`] 
                }
            };
        }
    }
);

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

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

function loadProject(projectPath?: string) {
  const resolvedPath = projectPath || findProjectPath();
  console.log(`Using project path: ${resolvedPath}`);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Project file not found at: ${resolvedPath}`);
  }
  const raw = fs.readFileSync(resolvedPath, "utf8");
  const parsed = YAML.parse(raw);
  return { raw, parsed, sha: sha256(raw), path: resolvedPath };
}

server.registerTool(
    'load_project',
    {
        title: 'Load OpenIntent Project Configuration',
        description: 'Load and parse the OpenIntent project.yaml file. Returns the raw content, parsed YAML, SHA256 hash, and file path.',
        inputSchema: { 
            project_path: z.string().optional().describe('Optional path to the project.yaml file. If not provided, searches for .openintent/project.yaml using standard resolution logic.')
        },
        outputSchema: { 
            path: z.string(),
            raw: z.string(),
            parsed: z.record(z.any()),
            sha: z.string()
        }
    },
    async ({ project_path }) => {
        try {
            const result = loadProject(project_path);
            return {
                content: [{ 
                    type: 'text', 
                    text: JSON.stringify({
                        path: result.path,
                        sha: result.sha,
                        parsed: result.parsed,
                        message: 'Project configuration loaded successfully'
                    }, null, 2)
                }],
                structuredContent: {
                    path: result.path,
                    raw: result.raw,
                    parsed: result.parsed,
                    sha: result.sha
                }
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return {
                content: [{ 
                    type: 'text', 
                    text: JSON.stringify({ 
                        error: errorMessage 
                    }) 
                }],
                structuredContent: { 
                    error: errorMessage 
                }
            };
        }
    }
);

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
 * Load compatibility matrix from packages/schema/compatibility/matrix.json
 */
function loadCompatibilityMatrix(): CompatibilityEntry[] {
    // Try multiple possible locations for the matrix
    const possiblePaths = [
        path.join('/app', 'compatibility', 'matrix.json'), // Docker container location
        path.join(__dirname, '../../packages/schema/compatibility/matrix.json'),
        path.join(__dirname, '../../../packages/schema/compatibility/matrix.json'),
        path.join(process.cwd(), 'packages/schema/compatibility/matrix.json'),
        path.join(process.cwd(), '../packages/schema/compatibility/matrix.json'),
    ];

    for (const matrixPath of possiblePaths) {
        if (fs.existsSync(matrixPath)) {
            console.log(`Loading compatibility matrix from: ${matrixPath}`);
            const content = fs.readFileSync(matrixPath, 'utf8');
            return JSON.parse(content);
        }
    }

    console.warn('⚠ Warning: Compatibility matrix not found at any expected location');
    return [];
}

/**
 * Check if a version satisfies a semver range
 * Simple implementation - supports: >=x.y.z <a.b.c patterns
 */
function satisfiesRange(version: string, range: string): boolean {
    const [gtePart, ltPart] = range.split(' ');
    
    const parseVersion = (v: string) => v.split('.').map(Number);
    const versionParts = parseVersion(version);
    
    // Check >= constraint
    if (gtePart?.startsWith('>=')) {
        const minVersion = parseVersion(gtePart.slice(2));
        for (let i = 0; i < 3; i++) {
            if (versionParts[i] < minVersion[i]) return false;
            if (versionParts[i] > minVersion[i]) break;
        }
    }
    
    // Check < constraint
    if (ltPart?.startsWith('<')) {
        const maxVersion = parseVersion(ltPart.slice(1));
        for (let i = 0; i < 3; i++) {
            if (versionParts[i] >= maxVersion[i]) return false;
            if (versionParts[i] < maxVersion[i]) break;
        }
    }
    
    return true;
}

server.registerTool(
    'resolve_template',
    {
        title: 'Resolve Template Pack for Framework',
        description: 'Resolve the appropriate template pack for a framework based on intent schema version and framework versions. Returns the template pack URI, digest, and compatibility information.',
        inputSchema: {
            intent_schema_version: z.string().describe('OIML intent schema version (e.g., "0.1.0")'),
            framework: z.string().describe('Framework name (e.g., "prisma", "next", "express")'),
            framework_version: z.string().describe('Installed framework version (e.g., "6.19.0", "15.0.0")'),
            category: z.enum(['database', 'api', 'ui']).optional().describe('Framework category (optional, can be inferred)')
        }
    },
    async ({ intent_schema_version, framework, framework_version, category }) => {
        try {
            console.log(`Resolving template for: ${framework}@${framework_version}, OIML ${intent_schema_version}`);
            
            const matrix = loadCompatibilityMatrix();
            
            // Find the framework entry
            const frameworkEntry = matrix.find(entry => 
                entry.framework === framework && 
                (!category || entry.category === category)
            );
            
            if (!frameworkEntry) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            compatible: false,
                            error: `Framework "${framework}" not found in compatibility matrix`,
                            available_frameworks: matrix.map(e => e.framework)
                        }, null, 2)
                    }],
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
                const frameworkCompatible = satisfiesRange(framework_version, v.compat[framework] || '>=0.0.0');
                return oimlCompatible && frameworkCompatible;
            });
            
            if (compatibleVersions.length === 0) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            compatible: false,
                            error: `No compatible template found for ${framework}@${framework_version} with OIML ${intent_schema_version}`,
                            framework: framework,
                            framework_version: framework_version,
                            intent_schema_version: intent_schema_version,
                            available_template_versions: frameworkEntry.versions.map(v => ({
                                version: v.template_version,
                                compat: v.compat
                            }))
                        }, null, 2)
                    }],
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
            const digest = crypto
                .createHash('sha256')
                .update(JSON.stringify(template))
                .digest('hex');
            
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
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }],
                structuredContent: result
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.error(`Error resolving template: ${errorMessage}`);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        compatible: false,
                        error: errorMessage
                    }, null, 2)
                }],
                structuredContent: {
                    compatible: false,
                    error: errorMessage
                }
            };
        }
    }
);

// Set up Express and HTTP transport
const app = express();
app.use(express.json());

// Health check endpoint for Docker and load balancers
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        service: 'oiml-mcp',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        schemaCache: {
            directory: SCHEMA_CACHE_DIR,
            exists: fs.existsSync(SCHEMA_CACHE_DIR),
            schemas: fs.existsSync(SCHEMA_CACHE_DIR) 
                ? fs.readdirSync(SCHEMA_CACHE_DIR).length 
                : 0
        }
    });
});

// Root endpoint with service info
app.get('/', (req, res) => {
    res.json({
        service: 'OpenIntent MCP Server',
        version: '1.0.0',
        description: 'Model Context Protocol server for OpenIntent validation and generation',
        endpoints: {
            mcp: '/mcp',
            health: '/health'
        },
        documentation: 'https://github.com/openintent/oiml'
    });
});

// MCP endpoint
app.post('/mcp', async (req, res) => {
    // Create a new transport for each request to prevent request ID collisions
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
    });

    res.on('close', () => {
        transport.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});

// Use PORT from environment or default to 3000 (changed from 4000 for container deployments)
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`OpenIntent MCP Server running on http://localhost:${port}`);
    console.log(`  - Health check: http://localhost:${port}/health`);
    console.log(`  - MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`  - Schema cache: ${SCHEMA_CACHE_DIR}`);
}).on('error', error => {
    console.error('Server error:', error);
    process.exit(1);
});