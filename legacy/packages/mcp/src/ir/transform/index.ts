/**
 * Intent to IR transformation exports
 */

export * from "./types.js";
export * from "./utils.js";

// Data intent transformers
export * from "./transformers/add-entity.js";
export * from "./transformers/add-field.js";
export * from "./transformers/add-relation.js";
export * from "./transformers/remove-entity.js";
export * from "./transformers/remove-field.js";
export * from "./transformers/rename-entity.js";
export * from "./transformers/rename-field.js";

// API intent transformers
export * from "./transformers/add-endpoint.js";
export * from "./transformers/update-endpoint.js";

// Capability intent transformers
export * from "./transformers/add-capability.js";

// UI intent transformers
export * from "./transformers/add-component.js";
