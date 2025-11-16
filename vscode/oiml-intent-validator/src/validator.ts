import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { getSchema } from "./schema-loader";

/**
 * Determines if a document should be validated based on its filename
 */
export function shouldValidateDocument(document: vscode.TextDocument): boolean {
  const config = vscode.workspace.getConfiguration("oiml");
  const filePattern = config.get<string>("filePattern", "**/intent.yaml");

  // Simple pattern matching - ends with intent.yaml
  return document.fileName.endsWith("intent.yaml");
}

/**
 * Converts a Zod error path to a line number in the YAML document
 */
function getLineFromPath(document: vscode.TextDocument, path: (string | number)[]): number {
  const text = document.getText();
  const lines = text.split("\n");

  if (path.length === 0) {
    return 0;
  }

  let currentLine = 0;
  let currentIndent = -1;

  // Navigate through the path step by step
  for (let pathIndex = 0; pathIndex < path.length; pathIndex++) {
    const pathElement = path[pathIndex];
    const isArrayIndex = typeof pathElement === "number";

    if (isArrayIndex) {
      // Find the Nth array item (marked with '-')
      const arrayIndex = pathElement as number;
      let itemsFound = 0;
      let foundLine = -1;

      for (let i = currentLine; i < lines.length; i++) {
        const line = lines[i];
        const indent = line.search(/\S/);

        // Skip if indent is less than or equal to current (we've left the array)
        if (indent !== -1 && currentIndent !== -1 && indent <= currentIndent) {
          break;
        }

        // Look for array item markers (lines starting with '- ')
        const trimmed = line.trimStart();
        if (trimmed.startsWith("- ")) {
          if (itemsFound === arrayIndex) {
            foundLine = i;
            currentLine = i;
            currentIndent = indent;
            break;
          }
          itemsFound++;
        }
      }

      if (foundLine === -1) {
        // Couldn't find the array item, return current position
        return currentLine;
      }
    } else {
      // Find the key in the YAML
      const searchKey = String(pathElement);
      let foundLine = -1;

      for (let i = currentLine; i < lines.length; i++) {
        const line = lines[i];
        const indent = line.search(/\S/);

        // Skip if we've gone too far back in indentation (unless this is the first key)
        if (currentIndent !== -1 && indent !== -1 && indent < currentIndent) {
          break;
        }

        // Look for the key
        const trimmed = line.trimStart();
        if (trimmed.startsWith(searchKey + ":") || trimmed.startsWith("- " + searchKey + ":")) {
          foundLine = i;
          currentLine = i;
          currentIndent = indent;
          break;
        }
      }

      if (foundLine === -1) {
        // Couldn't find the key, return current position
        return currentLine;
      }
    }
  }

  return currentLine;
}

/**
 * Gets the range for a specific key in the YAML document
 */
function getRangeForPath(document: vscode.TextDocument, path: (string | number)[]): vscode.Range {
  const line = getLineFromPath(document, path);
  const lineText = document.lineAt(line).text;
  const startChar = lineText.search(/\S/); // First non-whitespace character
  const endChar = lineText.length;

  return new vscode.Range(new vscode.Position(line, startChar), new vscode.Position(line, endChar));
}

/**
 * Formats a Zod error path for display
 */
function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return "root";
  return path.map(p => (typeof p === "number" ? `[${p}]` : p)).join(".");
}

/**
 * Validates a document against the OIML Intent schema
 */
export function validateDocument(
  document: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection
): void {
  // Clear previous diagnostics
  diagnosticCollection.delete(document.uri);

  if (!shouldValidateDocument(document)) {
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];

  try {
    // Parse YAML
    const content = yaml.load(document.getText());

    if (!content) {
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1000),
        "Empty YAML document",
        vscode.DiagnosticSeverity.Error
      );
      diagnostic.source = "OIML";
      diagnostics.push(diagnostic);
      diagnosticCollection.set(document.uri, diagnostics);
      return;
    }

    // Validate with Zod - get schema based on user's setting
    let IntentSchema;
    try {
      IntentSchema = getSchema();
    } catch (error) {
      // Handle schema loading errors (e.g., invalid version setting)
      const errorMessage = error instanceof Error ? error.message : "Unknown error loading schema";
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1000),
        `OIML Schema Error: ${errorMessage}`,
        vscode.DiagnosticSeverity.Error
      );
      diagnostic.source = "OIML";
      diagnostics.push(diagnostic);
      diagnosticCollection.set(document.uri, diagnostics);
      return;
    }

    const result = IntentSchema.safeParse(content);

    if (!result.success) {
      // Convert Zod errors to VSCode diagnostics
      result.error.issues.forEach((issue: any) => {
        const range = getRangeForPath(document, issue.path);
        const pathStr = formatPath(issue.path);

        let message = issue.message;
        if (pathStr !== "root") {
          message = `[${pathStr}] ${message}`;
        }

        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = "OIML";
        diagnostic.code = issue.code;
        diagnostics.push(diagnostic);
      });
    }
  } catch (error) {
    // Handle YAML parsing errors
    let message = "Unknown error";
    let line = 0;

    if (error instanceof yaml.YAMLException) {
      message = `YAML parsing error: ${error.message}`;
      if (error.mark) {
        line = error.mark.line;
      }
    } else if (error instanceof Error) {
      message = `Error: ${error.message}`;
    }

    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, 0, line, 1000),
      message,
      vscode.DiagnosticSeverity.Error
    );
    diagnostic.source = "OIML";
    diagnostics.push(diagnostic);
  }

  diagnosticCollection.set(document.uri, diagnostics);
}

/**
 * Validates all intent.yaml files in the workspace
 */
export async function validateWorkspace(diagnosticCollection: vscode.DiagnosticCollection): Promise<void> {
  const config = vscode.workspace.getConfiguration("oiml");
  const filePattern = config.get<string>("filePattern", "**/intent.yaml");

  const files = await vscode.workspace.findFiles(filePattern, "**/node_modules/**");

  for (const file of files) {
    const document = await vscode.workspace.openTextDocument(file);
    validateDocument(document, diagnosticCollection);
  }

  vscode.window.showInformationMessage(`OIML: Validated ${files.length} intent file(s)`);
}
