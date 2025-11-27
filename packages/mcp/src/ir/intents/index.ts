/**
 * Intent IR exports
 * Version: 1.0.0
 */

import { z } from "zod";

export * from "./add-entity.js";
export * from "./add-field.js";
export * from "./add-relation.js";
export * from "./remove-entity.js";
export * from "./remove-field.js";
export * from "./rename-entity.js";
export * from "./rename-field.js";
export * from "./add-endpoint.js";
export * from "./update-endpoint.js";
export * from "./add-capability.js";
export * from "./add-component.js";

// Import Zod schemas for union
import { AddEntityIRV1 } from "./add-entity.js";
import { AddFieldIRV1 } from "./add-field.js";
import { AddRelationIRV1 } from "./add-relation.js";
import { RemoveEntityIRV1 } from "./remove-entity.js";
import { RemoveFieldIRV1 } from "./remove-field.js";
import { RenameEntityIRV1 } from "./rename-entity.js";
import { RenameFieldIRV1 } from "./rename-field.js";
import { AddEndpointIRV1 } from "./add-endpoint.js";
import { UpdateEndpointIRV1 } from "./update-endpoint.js";
import { AddCapabilityIRV1 } from "./add-capability.js";
import { AddComponentIRV1 } from "./add-component.js";

/**
 * Zod schema for all intent IR versions (discriminated union)
 */
export const IntentIR = z.discriminatedUnion("kind", [
  AddEntityIRV1,
  AddFieldIRV1,
  AddRelationIRV1,
  RemoveEntityIRV1,
  RemoveFieldIRV1,
  RenameEntityIRV1,
  RenameFieldIRV1,
  AddEndpointIRV1,
  UpdateEndpointIRV1,
  AddCapabilityIRV1,
  AddComponentIRV1
]);

/**
 * TypeScript type for all intent IR versions
 */
export type IntentIR = z.infer<typeof IntentIR>;
