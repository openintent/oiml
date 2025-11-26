"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, AlertCircle, Sparkles, Check, Code, RefreshCw } from "lucide-react";
import type { ElectronAPI } from "@/types/electron";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import * as yaml from "js-yaml";
import { IntentHumanView } from "@/components/IntentHumanView";
import { toast } from "sonner";

interface LinearIssue {
  id: string;
  key: string;
  title: string;
  url: string;
  description: string | null;
  status: string;
  source: string;
  ac: Array<{ text: string; status: string }>;
  lastSyncedAt: string;
}

interface ProjectConfig {
  name?: string;
  version?: string;
  api?: {
    framework?: string;
    language?: string;
  };
  database?: {
    type?: string;
    framework?: string;
  };
  ui?: {
    framework?: string;
  };
  paths?: {
    api?: string;
  };
}

interface LinearIssueViewProps {
  issueId: string;
  projectVersion?: string;
  intentFolderPath?: string;
  projectConfig?: ProjectConfig | null;
  onIntentApplied?: () => void;
  openaiApiKey?: string;
}

const getElectronAPI = (): ElectronAPI | undefined => {
  if (typeof window === "undefined") return undefined;
  return window.electronAPI;
};

// Validate intent against OIML schema using @oiml/schema package
const validateIntent = async (yamlContent: string): Promise<{ valid: boolean; errors?: string[] }> => {
  try {
    // Parse YAML first to get the version
    const parsed = yaml.load(yamlContent);
    if (!parsed || typeof parsed !== "object") {
      return { valid: false, errors: ["Invalid YAML structure"] };
    }

    const parsedObj = parsed as Record<string, unknown>;
    const version = parsedObj.version as string | undefined;

    if (!version) {
      return { valid: false, errors: ["Missing required field: version"] };
    }

    // Dynamically import the schema based on version
    // For now, we support 0.1.0. In the future, we can extend this to support multiple versions
    let IntentSchema;
    try {
      if (version === "0.1.0") {
        // Import the Intent schema from @oiml/schema package
        const schemaModule = await import("@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js");
        IntentSchema = schemaModule.Intent;
      } else {
        return {
          valid: false,
          errors: [`Unsupported schema version: ${version}. Currently only version 0.1.0 is supported.`]
        };
      }
    } catch (importErr) {
      console.error("Error importing schema:", importErr);
      return {
        valid: false,
        errors: [
          `Failed to load schema for version ${version}: ${importErr instanceof Error ? importErr.message : String(importErr)}`
        ]
      };
    }

    // Validate using Zod schema
    const result = IntentSchema.safeParse(parsedObj);

    if (result.success) {
      return { valid: true };
    } else {
      // Format Zod errors into readable messages
      const errors = result.error.errors.map(err => {
        const path = err.path.join(".");
        return `${path}: ${err.message}`;
      });
      return { valid: false, errors };
    }
  } catch (err) {
    return { valid: false, errors: [`Validation error: ${err instanceof Error ? err.message : String(err)}`] };
  }
};

export function LinearIssueView({
  issueId,
  projectVersion = "0.1.0",
  intentFolderPath,
  projectConfig,
  onIntentApplied,
  openaiApiKey = ""
}: LinearIssueViewProps) {
  const [issue, setIssue] = useState<LinearIssue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedIntents, setGeneratedIntents] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [viewMode, setViewMode] = useState<"human" | "code">("human");
  const [parsedIntentData, setParsedIntentData] = useState<Record<string, unknown> | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);

  const fetchIssue = useCallback(async () => {
    if (!issueId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI || !electronAPI.fetchLinearIssue) {
        throw new Error("Electron API not available. This feature requires the Electron app.");
      }

      const result = await electronAPI.fetchLinearIssue(issueId);

      if (!result.success) {
        throw new Error(result.error || "Failed to fetch Linear issue");
      }

      setIssue(result.data as LinearIssue | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Linear issue");
      console.error("Error fetching Linear issue:", err);
    } finally {
      setIsLoading(false);
    }
  }, [issueId]);

  useEffect(() => {
    fetchIssue();
  }, [fetchIssue]);

  const handleGenerateIntent = async () => {
    if (!issue || !issue.description) {
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI || !electronAPI.callOpenAI) {
        throw new Error("Electron API not available. This feature requires the Electron app.");
      }

      // Format acceptance criteria for the prompt
      const acceptanceCriteria = issue.ac.map(ac => `- ${ac.text}`).join("\n");

      const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

      // Build project context for API path recommendations
      let projectContext = "";
      if (projectConfig) {
        const apiFramework = projectConfig.api?.framework || "";
        const apiPath = projectConfig.paths?.api || "";

        projectContext = `\nPROJECT CONTEXT (from project.yaml):
- API Framework: ${apiFramework || "Not specified"}
- API Path: ${apiPath || "Not specified"}
- Database Framework: ${projectConfig.database?.framework || "Not specified"}
- UI Framework: ${projectConfig.ui?.framework || "Not specified"}

IMPORTANT API PATH RULES:
- For Next.js projects: API endpoints should use the /api prefix (e.g., /api/posts, /api/users)
- For Express.js projects: API endpoints typically don't use /api prefix (e.g., /posts, /users)
- For other frameworks: Follow framework conventions
- Use the paths.api value from project.yaml if specified
`;
      }

      // Read the OIML schema file to include in the prompt
      let schemaContext = "";
      try {
        const electronAPI = getElectronAPI();
        if (electronAPI && electronAPI.readFile && electronAPI.resolvePackagePath) {
          // Resolve the package path to actual file system path
          const resolveResult = await electronAPI.resolvePackagePath(
            "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js"
          );
          if (resolveResult?.success && resolveResult.path) {
            const schemaResult = await electronAPI.readFile(resolveResult.path);
            if (schemaResult.success && schemaResult.content) {
              // Extract key schema information for the prompt
              schemaContext = `

OIML SCHEMA DEFINITION (CRITICAL - FOLLOW THIS EXACTLY):
The following Zod schema defines the valid structure for OIML intent files. You MUST follow this schema exactly:

${schemaResult.content}

KEY SCHEMA REQUIREMENTS:
1. ai_context.instructions MUST be a STRING (not an array). Use a multiline string format:
   instructions: "CRITICAL: Call the MCP tool get_agents_guide FIRST before proceeding to retrieve the OIML Agents implementation guide and apply the instructions to the intent."

2. add_endpoint intent structure (from AddEndpoint schema):
   - kind: "add_endpoint" (literal)
   - scope: "api" (literal)
   - method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
   - path: string (must start with "/")
   - description: string (optional)
   - entity: string (optional)
   - fields: array of Field objects (optional)
   - auth: object with required (boolean) and roles (array of strings) (optional)
   
   DO NOT include "parameters" or "returns" fields - these are NOT in the schema!

3. Field structure (from Field schema):
   - name: string (required)
   - type: one of "string", "text", "integer", "bigint", "float", "decimal", "boolean", "datetime", "date", "time", "uuid", "json", "enum", "array", "bytes"
   - required: boolean (optional)
   - unique: boolean (optional)
   - default: any (optional)
   - max_length: number (optional)
   - array_type: enum (optional, required when type is "array")
   - enum_values: array of strings (optional, required when type is "enum")
   - relation: FieldRelation object (optional)
   - api: object (optional)

4. All intents must be valid according to the IntentUnion schema (add_entity, add_field, add_endpoint, add_relation, etc.)
`;
            }
          }
        }
      } catch (err) {
        console.error("Error reading schema file:", err);
      }

      const prompt = `Convert the following Linear issue acceptance criteria into valid OIML intent objects.${projectContext}${schemaContext}

Issue Title: ${issue.title}
Issue Description: ${issue.description || "N/A"}

${acceptanceCriteria ? `Acceptance Criteria: ${acceptanceCriteria}` : ""}

IMPORTANT RULES:
1. When creating a new entity with fields, use a SINGLE add_entity intent with all fields in the fields array. DO NOT create separate add_field intents for fields that belong to a new entity.
2. Only use add_field when adding fields to an EXISTING entity that already exists.
3. Combine related operations into single intents when possible (e.g., all fields for a new entity should be in one add_entity intent).
4. Use add_field only when explicitly adding fields to an entity that was mentioned as already existing.
5. CRITICAL: Follow the OIML schema exactly. Do not add fields that are not in the schema (e.g., "parameters" or "returns" in add_endpoint).
6. CRITICAL: ai_context.instructions must be a STRING, not an array.

Return ONLY valid YAML following the OIML intent schema format. The response must be a complete intent.yaml file with the EXACT structure shown below:

\`\`\`yaml
version: "${projectVersion}"
type: oiml.intent
ai_context:
  purpose: "Conform to project frameworks, style, and conventions."
  instructions: "CRITICAL: Call the MCP tool get_agents_guide FIRST before proceeding to retrieve the OIML Agents implementation guide and apply the instructions to the intent."
  references:
    - kind: mcp_tool
      tool: get_agents_guide
      description: "OIML Agents implementation guide containing workflow instructions, framework-specific patterns, and best practices"
provenance:
  created_by:
    type: agent
    name: ""
  created_at: "${now}"
  source: "linear"
intents:
  # Your generated intents go here
\`\`\`

IMPORTANT YAML FORMATTING RULES:
- The instructions field MUST be a STRING (multiline string), NOT an array.
- Use YAML multiline string syntax: | or > for multiline strings
- For single-line instructions, use: instructions: "Your instruction here"

Each intent in the intents array should have:
- kind: one of add_entity, add_field, add_endpoint, add_relation, etc.
- scope: "data" or "api" or "ui" or "capability"
- Other required fields based on the intent kind (see schema above)

Example of CORRECT format for a new entity:
\`\`\`yaml
intents:
  - kind: add_entity
    scope: data
    entity: Post
    fields:
      - name: id
        type: uuid
        required: true
      - name: title
        type: text
        required: true
      - name: description
        type: text
\`\`\`

Example of CORRECT format for add_endpoint:
\`\`\`yaml
intents:
  - kind: add_endpoint
    scope: api
    method: POST
    path: "/api/posts"
    description: "Create a new post"
    entity: Post
    fields:
      - name: title
        type: text
        required: true
      - name: description
        type: text
\`\`\`

Example of INCORRECT format (DO NOT DO THIS):
\`\`\`yaml
intents:
  - kind: add_entity
    scope: data
    entity: Post
  - kind: add_field
    scope: data
    entity: Post
    fields:
      - name: id
        type: uuid
  - kind: add_field
    scope: data
    entity: Post
    fields:
      - name: title
        type: text
\`\`\`

CRITICAL OUTPUT REQUIREMENTS:
- You MUST return ONLY the raw YAML content
- Do NOT include markdown code blocks (no \`\`\`yaml or \`\`\`)
- Do NOT include any explanatory text before or after the YAML
- Do NOT include text like "The above YAML..." or any descriptions
- The response must start directly with "version:" and end with valid YAML
- Your entire response must be valid YAML that can be parsed directly
- If you include any text other than YAML, the response will fail

Your response must be ONLY the YAML content, nothing else.`;

      const result = await electronAPI.callOpenAI(
        [
          {
            role: "system",
            content:
              "You are an expert at converting requirements into OIML (Open Intent Modeling Language) intent specifications. You MUST return ONLY valid YAML content - no markdown code blocks, no explanations, no additional text before or after the YAML. The response must start with 'version:' and end with valid YAML. Do not include any text like 'The above YAML...' or similar explanations."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        "gpt-5.1"
      );

      if (!result.success) {
        throw new Error(result.error || "Failed to generate intents");
      }

      const content = (result.data as any)?.choices?.[0]?.message?.content;
      if (content) {
        // Remove markdown code blocks if present
        let cleanedContent = content
          .replace(/^```yaml\n?/gm, "")
          .replace(/^```\n?/gm, "")
          .replace(/```$/gm, "")
          .trim();

        // Remove any explanatory text after the YAML
        // Look for common patterns like "The above YAML", "This YAML", etc.
        const explanatoryTextPatterns = [
          /\n\nThe above YAML[\s\S]*/i,
          /\n\nThis YAML[\s\S]*/i,
          /\n\nThe YAML[\s\S]*/i,
          /\n\nAbove[\s\S]*/i,
          /\n\nNote:[\s\S]*/i,
          /\n\n\*\*Note:[\s\S]*/i,
          /\n\n---[\s\S]*/i,
          /\n\nHere[\s\S]*/i,
          /\n\nThis[\s\S]*/i
        ];

        for (const pattern of explanatoryTextPatterns) {
          cleanedContent = cleanedContent.replace(pattern, "");
        }

        // Also remove any text that starts after a blank line and doesn't look like YAML
        // Find the last line that looks like YAML (starts with spaces, dash, or a key:value)
        const lines = cleanedContent.split("\n");
        let lastYamlLineIndex = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          // Check if line looks like YAML (key:value, list item, or empty)
          if (
            line === "" ||
            line.match(/^[a-z_]+:/i) ||
            line.match(/^-\s/) ||
            line.match(/^\s+[a-z_]+:/i) ||
            line.match(/^\s+-\s/)
          ) {
            lastYamlLineIndex = i;
            break;
          }
        }

        // If we found a YAML line, remove everything after it that doesn't look like YAML
        if (lastYamlLineIndex >= 0 && lastYamlLineIndex < lines.length - 1) {
          // Check if there's explanatory text after the last YAML line
          const remainingLines = lines.slice(lastYamlLineIndex + 1);
          const hasExplanatoryText = remainingLines.some((line: string) => {
            const trimmed = line.trim();
            return (
              trimmed.length > 0 &&
              !trimmed.match(/^[a-z_]+:/i) &&
              !trimmed.match(/^-\s/) &&
              !trimmed.match(/^\s+[a-z_]+:/i) &&
              !trimmed.match(/^\s+-\s/)
            );
          });

          if (hasExplanatoryText) {
            cleanedContent = lines.slice(0, lastYamlLineIndex + 1).join("\n");
          }
        }

        cleanedContent = cleanedContent.trim();

        // Fix common YAML issues: ensure instructions list items are properly formatted
        // Fix multiline list items that contain colons by joining continuation lines
        const fixedLines: string[] = [];
        let inInstructionsList = false;
        let currentListItem = "";

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();

          // Detect if we're entering the instructions list
          if (line.match(/^\s*instructions:\s*$/)) {
            inInstructionsList = true;
            fixedLines.push(line);
            continue;
          }

          // Detect if we're leaving the instructions list (next key at same or less indentation)
          if (inInstructionsList && line.match(/^\s+[a-z_]+:/) && !line.match(/^\s+-/)) {
            // If we have a pending list item, add it
            if (currentListItem) {
              fixedLines.push(`  - ${currentListItem.trim()}`);
              currentListItem = "";
            }
            inInstructionsList = false;
            fixedLines.push(line);
            continue;
          }

          // Handle list items in instructions
          if (inInstructionsList) {
            if (line.match(/^\s+-\s+/)) {
              // New list item - save previous if exists
              if (currentListItem) {
                fixedLines.push(`  - ${currentListItem.trim()}`);
              }
              // Start new list item
              currentListItem = line.replace(/^\s+-\s+/, "");
            } else if (line.match(/^\s+[^\s-]/) && currentListItem) {
              // Continuation line - append to current item with space
              currentListItem += " " + trimmed;
            } else {
              // Not a list item or continuation - add as-is
              if (currentListItem) {
                fixedLines.push(`  - ${currentListItem.trim()}`);
                currentListItem = "";
              }
              fixedLines.push(line);
            }
          } else {
            fixedLines.push(line);
          }
        }

        // Add any remaining list item
        if (currentListItem) {
          fixedLines.push(`  - ${currentListItem.trim()}`);
        }

        cleanedContent = fixedLines.join("\n");
        setGeneratedIntents(cleanedContent);

        // Parse YAML for human-readable view
        try {
          const parsed = yaml.load(cleanedContent) as Record<string, unknown>;
          setParsedIntentData(parsed);
          setViewMode("human"); // Reset to human view when opening dialog
        } catch (err) {
          console.error("Error parsing generated YAML:", err);
          setParsedIntentData(null);
          setViewMode("code"); // Default to code view if parsing fails
          // Error is handled gracefully by showing code view with a warning message
        }

        // Validate the generated intents
        try {
          const validationResult = await validateIntent(cleanedContent);
          if (!validationResult.valid && validationResult.errors) {
            setValidationErrors(validationResult.errors);
          } else {
            setValidationErrors(null);
          }
        } catch (err) {
          console.error("Error validating intents:", err);
          setValidationErrors([`Validation error: ${err instanceof Error ? err.message : String(err)}`]);
        }

        setIsDialogOpen(true);
      } else {
        throw new Error("No response content received");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate intents");
      console.error("Error generating intents:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!generatedIntents || !intentFolderPath) {
      return;
    }

    setIsApplying(true);
    setError(null);

    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI || !electronAPI.writeFile) {
        throw new Error("Electron API not available. This feature requires the Electron app.");
      }

      const intentFilePath = `${intentFolderPath}/intent.yaml`;

      // Ensure the directory exists
      if (!electronAPI.mkdir) {
        throw new Error("mkdir not available");
      }
      await electronAPI.mkdir(intentFolderPath);

      // Write the file
      const result = await electronAPI.writeFile(intentFilePath, generatedIntents);

      if (!result.success) {
        throw new Error(result.error || "Failed to write intent.yaml file");
      }

      // Show success toast
      toast.success("Intent applied successfully", {
        description: "The intent.yaml file has been updated."
      });

      // Close the dialog on success
      setIsDialogOpen(false);
      setGeneratedIntents(null);
      setValidationErrors(null);
      setValidationErrors(null);

      // Switch to Intent tab if callback provided
      if (onIntentApplied) {
        onIntentApplied();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply intents");
      console.error("Error applying intents:", err);
    } finally {
      setIsApplying(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!issue) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <p className="text-sm">No issue found</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1 flex items-center gap-4">
            <CardTitle className="text-lg">{issue.title}</CardTitle>
            <Badge variant="outline">{issue.status}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={fetchIssue} disabled={isLoading} size="icon" variant="outline">
              <RefreshCw className="w-4 h-4" />
            </Button>
            {issue.url && (
              <Button
                variant="outline"
                size="icon"
                onClick={() => window.open(issue.url, "_blank", "noopener,noreferrer")}
                className="h-9 w-9"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            )}
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      onClick={handleGenerateIntent}
                      disabled={isGenerating || !issue?.description || !openaiApiKey}
                      size="sm"
                      className="gap-2"
                    >
                      {isGenerating ? (
                        <>
                          <Spinner className="w-4 h-4" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Generate Intent
                        </>
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!openaiApiKey && (
                  <TooltipContent>
                    <p>Enable in project settings</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {issue.description && (
          <div>
            <h3 className="text-sm font-semibold mb-2">Description</h3>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{issue.description}</div>
          </div>
        )}

        {/* {issue.ac && issue.ac.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2">Acceptance Criteria</h3>
            <ul className="space-y-2">
              {issue.ac.map((ac, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <span className="text-muted-foreground mt-0.5">•</span>
                  <span className="text-muted-foreground">{ac.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )} */}
      </CardContent>

      {/* Generated Intents Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-4xl max-h-[80vh] [&>button]:hidden"
          onInteractOutside={e => {
            // Prevent closing when clicking outside
            e.preventDefault();
          }}
          onEscapeKeyDown={e => {
            // Prevent closing when pressing Escape
            e.preventDefault();
          }}
        >
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Suggested Intents</DialogTitle>
                {/* <DialogDescription>Intents generated from Linear acceptance criteria</DialogDescription> */}
              </div>
              <Button
                onClick={() => setViewMode(viewMode === "human" ? "code" : "human")}
                size="sm"
                variant={viewMode === "code" ? "default" : "outline"}
                className="gap-2"
              >
                <Code className="w-4 h-4" />
                View Code
              </Button>
            </div>
          </DialogHeader>

          {/* Validation Banner */}
          {validationErrors && validationErrors.length > 0 && (
            <Card className="border-red-500 dark:border-red-500/50 bg-red-50 dark:bg-red-950/20">
              <CardHeader className="pb-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <CardTitle className="text-sm text-red-900 dark:text-red-100">Schema Validation Failed</CardTitle>
                    <CardDescription className="text-xs text-red-700 dark:text-red-300 mt-1">
                      The generated intents do not conform to the OIML schema version{" "}
                      {(parsedIntentData?.version as string) || "unknown"}.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="list-disc list-inside space-y-1 text-sm text-red-800 dark:text-red-200">
                  {validationErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {validationErrors === null && parsedIntentData && (
            <Card className="border-green-500 dark:border-green-500/50 bg-green-50 dark:bg-green-950/20">
              <CardHeader className="pb-3">
                <div className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <CardTitle className="text-sm text-green-900 dark:text-green-100">
                      Schema Validation Passed
                    </CardTitle>
                    <CardDescription className="text-xs text-green-700 dark:text-green-300 mt-1">
                      The generated intents are valid according to the OIML schema version{" "}
                      {(parsedIntentData.version as string) || "unknown"}.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          )}

          <div className="overflow-auto max-h-[60vh]">
            {viewMode === "human" && parsedIntentData ? (
              <IntentHumanView intentData={parsedIntentData} />
            ) : generatedIntents ? (
              <div className="rounded-lg overflow-hidden">
                {parsedIntentData === null && viewMode === "human" && (
                  <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      Unable to parse YAML for human-readable view. Showing code view instead.
                    </p>
                  </div>
                )}
                <SyntaxHighlighter
                  language="yaml"
                  style={vscDarkPlus}
                  customStyle={{
                    margin: 0,
                    padding: "1rem",
                    fontSize: "0.875rem",
                    lineHeight: "1.5",
                    backgroundColor: "#111111",
                    borderRadius: "0.5rem"
                  }}
                >
                  {generatedIntents}
                </SyntaxHighlighter>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsDialogOpen(false)} disabled={isApplying}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleApply} disabled={isApplying || !generatedIntents || !intentFolderPath}>
              {isApplying ? "Applying..." : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
