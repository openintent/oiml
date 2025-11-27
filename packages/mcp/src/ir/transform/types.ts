/**
 * Types for intent-to-IR transformation
 */

import { DiagnosticIR } from "../common.js";

/**
 * Context provided to transformers
 */
export interface TransformContext {
  /** Project identifier */
  projectId: string;
  /** Intent identifier (hash, URI, etc.) */
  intentId: string;
  /** OIML version from the source intent */
  oimlVersion: string;
  /** AI model used (if applicable) */
  model?: string;
  /** Existing entities in the project (for validation) */
  existingEntities?: string[];
  /** Existing enums in the project (for validation) */
  existingEnums?: string[];
}

/**
 * Options for transformation
 */
export interface TransformOptions {
  /** Whether to infer missing defaults */
  inferDefaults?: boolean;
  /** Whether to add automatic indexes */
  autoIndex?: boolean;
  /** Naming convention for tables */
  tableNamingConvention?: "snake_case" | "camelCase" | "PascalCase";
  /** Whether to validate against existing entities */
  validateReferences?: boolean;
}

/**
 * Result of transformation
 */
export interface TransformResult<T> {
  /** Transformed IR */
  ir: T;
  /** Diagnostics collected during transformation */
  diagnostics: DiagnosticIR[];
}

/**
 * Diagnostic helper for collecting issues during transformation
 */
export class DiagnosticCollector {
  private diagnostics: DiagnosticIR[] = [];

  info(code: string, message: string, path?: string) {
    this.diagnostics.push({ level: "Info", code, message, path });
  }

  warn(code: string, message: string, path?: string) {
    this.diagnostics.push({ level: "Warning", code, message, path });
  }

  error(code: string, message: string, path?: string) {
    this.diagnostics.push({ level: "Error", code, message, path });
  }

  hasErrors(): boolean {
    return this.diagnostics.some(d => d.level === "Error");
  }

  getDiagnostics(): DiagnosticIR[] {
    return [...this.diagnostics];
  }
}
