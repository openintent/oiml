/**
 * OIML Intermediate Representation (IR) Schema
 * Version: 1.0.0
 *
 * This module provides IR schemas that convert human-authored OIML YAML files
 * to a more machine-friendly, framework-agnostic format for code generation.
 *
 * The IR layer:
 * - Resolves ambiguities in human-authored intents
 * - Normalizes field types and configurations
 * - Provides a stable, deterministic format for code generators
 * - Separates concerns between human intent and machine implementation
 */

// Common types
export * from "./common.js";
export * from "./types.js";
export * from "./storage.js";
export * from "./field.js";
export * from "./entity.js";
export * from "./seed.js";

// Intent IRs
export * from "./intents/index.js";

// Transformers
export * from "./transform/index.js";
