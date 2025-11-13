/**
 * Schema Loader
 * 
 * Dynamically loads OIML schema versions that are bundled with the extension.
 * All available schema versions are bundled at build time and can be selected
 * via the VSCode extension settings.
 */

import * as vscode from 'vscode';

// Schema modules will be imported here at build time
// Each version will be bundled and made available
const schemaModules: Record<string, any> = {};

/**
 * Get the schema for a specific version
 */
export function getSchemaForVersion(version: string): any {
  if (!schemaModules[version]) {
    const availableVersions = Object.keys(schemaModules);
    if (availableVersions.length === 0) {
      throw new Error(`No schema versions are available. Please rebuild the extension.`);
    }
    throw new Error(`Schema version "${version}" is not available. Available versions: ${availableVersions.join(', ')}. Please update the "oiml.schemaVersion" setting to one of the available versions.`);
  }
  return schemaModules[version].Intent;
}

/**
 * Get the schema based on user's VSCode setting
 */
export function getSchema(): any {
  const config = vscode.workspace.getConfiguration('oiml');
  const version = config.get<string>('schemaVersion', '0.1.0');
  return getSchemaForVersion(version);
}

/**
 * Get list of available schema versions
 */
export function getAvailableVersions(): string[] {
  return Object.keys(schemaModules);
}

/**
 * Register a schema module for a specific version
 * This is called at build time when schemas are bundled
 */
export function registerSchema(version: string, module: any): void {
  schemaModules[version] = module;
}

