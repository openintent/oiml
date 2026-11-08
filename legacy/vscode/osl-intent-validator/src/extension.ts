import * as vscode from "vscode";
import { validateDocument, validateWorkspace, shouldValidateDocument } from "./validator";
import { registerAllSchemas } from "./schemas";

let diagnosticCollection: vscode.DiagnosticCollection;

/**
 * Extension activation function
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("OSL Intent Validator extension is now active");

  // Register all bundled schema versions
  registerAllSchemas();

  // Create diagnostic collection
  diagnosticCollection = vscode.languages.createDiagnosticCollection("osl");
  context.subscriptions.push(diagnosticCollection);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("osl.validateWorkspace", async () => {
      await validateWorkspace(diagnosticCollection);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("osl.validateCurrentFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        validateDocument(editor.document, diagnosticCollection);
        vscode.window.showInformationMessage("OSL: File validated");
      } else {
        vscode.window.showWarningMessage("OSL: No active editor");
      }
    })
  );

  // Validate on document open
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(document => {
      if (shouldValidateDocument(document)) {
        validateDocument(document, diagnosticCollection);
      }
    })
  );

  // Validate on document change (real-time validation)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      const config = vscode.workspace.getConfiguration("osl");
      const validateOnType = config.get<boolean>("validateOnType", true);

      if (validateOnType && shouldValidateDocument(event.document)) {
        validateDocument(event.document, diagnosticCollection);
      }
    })
  );

  // Validate on document save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(document => {
      const config = vscode.workspace.getConfiguration("osl");
      const validateOnSave = config.get<boolean>("validateOnSave", true);

      if (validateOnSave && shouldValidateDocument(document)) {
        validateDocument(document, diagnosticCollection);
      }
    })
  );

  // Validate all currently open intent.yaml files on activation
  vscode.workspace.textDocuments.forEach(document => {
    if (shouldValidateDocument(document)) {
      validateDocument(document, diagnosticCollection);
    }
  });

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("osl")) {
        // Re-validate all open documents when settings change
        // This includes schema version changes
        vscode.workspace.textDocuments.forEach(document => {
          if (shouldValidateDocument(document)) {
            validateDocument(document, diagnosticCollection);
          }
        });

        // Show notification if schema version changed
        if (event.affectsConfiguration("osl.schemaVersion")) {
          const config = vscode.workspace.getConfiguration("osl");
          const version = config.get<string>("schemaVersion", "0.1.0");
          vscode.window.showInformationMessage(`OSL: Schema version changed to ${version}. Re-validating files...`);
        }
      }
    })
  );
}

/**
 * Extension deactivation function
 */
export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}
