import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import crypto from "node:crypto";
import { IntentDoc, ProjectConfig } from '@oiml/schema';

const server = new McpServer({
    name: 'oiml-mcp',
    version: '1.0.0'
});

server.registerTool(
    'validate_intent',
    {
        title: 'OpenIntent Validation Tool',
        description: 'Validate an OpenIntent file against the schema',
        inputSchema: { 
            filePath: z.string().describe('Path to the OpenIntent file (.yaml, .yml, or .json)')
        },
        outputSchema: { 
            valid: z.boolean(),
            errors: z.array(z.string()).optional(),
            warnings: z.array(z.string()).optional()
        }
    },
    async ({ filePath }) => {
        try {
            if (!fs.existsSync(filePath)) {
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors: [`File not found: ${filePath}`] 
                        }) 
                    }],
                    structuredContent: { 
                        valid: false, 
                        errors: [`File not found: ${filePath}`] 
                    }
                };
            }

            const rawContent = fs.readFileSync(filePath, 'utf8');
            
            // Parse based on file extension
            let parsedContent;
            const ext = path.extname(filePath).toLowerCase();
            
            if (ext === '.json') {
                parsedContent = JSON.parse(rawContent);
            } else if (ext === '.yaml' || ext === '.yml' || ext === '.oiml') {
                parsedContent = YAML.parse(rawContent);
            } else {
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors: [`Unsupported file format: ${ext}. Supported formats: .json, .yaml, .yml, .oiml`] 
                        }) 
                    }],
                    structuredContent: { 
                        valid: false, 
                        errors: [`Unsupported file format: ${ext}. Supported formats: .json, .yaml, .yml, .oiml`] 
                    }
                };
            }

            // Validate against the schema
            const result = IntentDoc.safeParse(parsedContent);
            
            if (result.success) {
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: true,
                            message: 'File is valid according to OpenIntent schema'
                        }) 
                    }],
                    structuredContent: { 
                        valid: true 
                    }
                };
            } else {
                const errors = result.error.errors.map(err => 
                    `${err.path.join('.')}: ${err.message}`
                );
                
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors 
                        }) 
                    }],
                    structuredContent: { 
                        valid: false, 
                        errors 
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
                        errors: [`Parse error: ${errorMessage}`] 
                    }) 
                }],
                structuredContent: { 
                    valid: false, 
                    errors: [`Parse error: ${errorMessage}`] 
                }
            };
        }
    }
);

server.registerTool(
    'validate_project',
    {
        title: 'OpenIntent Project Configuration Validation Tool',
        description: 'Validate a project.yaml file against the OpenIntent project schema',
        inputSchema: { 
            filePath: z.string().describe('Path to the project.yaml file')
        },
        outputSchema: { 
            valid: z.boolean(),
            errors: z.array(z.string()).optional(),
            warnings: z.array(z.string()).optional()
        }
    },
    async ({ filePath }) => {
        try {
            if (!fs.existsSync(filePath)) {
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors: [`File not found: ${filePath}`] 
                        }) 
                    }],
                    structuredContent: { 
                        valid: false, 
                        errors: [`File not found: ${filePath}`] 
                    }
                };
            }

            const rawContent = fs.readFileSync(filePath, 'utf8');
            
            // Parse YAML
            let parsedContent;
            try {
                parsedContent = YAML.parse(rawContent);
            } catch (parseError) {
                const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parse error';
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors: [`YAML parse error: ${errorMessage}`] 
                        }) 
                    }],
                    structuredContent: { 
                        valid: false, 
                        errors: [`YAML parse error: ${errorMessage}`] 
                    }
                };
            }

            // Validate against the schema
            const result = ProjectConfig.safeParse(parsedContent);
            
            if (result.success) {
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: true,
                            message: 'Project configuration is valid according to OpenIntent schema'
                        }) 
                    }],
                    structuredContent: { 
                        valid: true 
                    }
                };
            } else {
                const errors = result.error.errors.map(err => 
                    `${err.path.join('.')}: ${err.message}`
                );
                
                return {
                    content: [{ 
                        type: 'text', 
                        text: JSON.stringify({ 
                            valid: false, 
                            errors 
                        }) 
                    }],
                    structuredContent: { 
                        valid: false, 
                        errors 
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

// Set up Express and HTTP transport
const app = express();
app.use(express.json());

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

const port = 4000;
app.listen(port, () => {
    console.log(`OpenIntent MCP Server running on http://localhost:${port}/mcp`);
}).on('error', error => {
    console.error('Server error:', error);
    process.exit(1);
});