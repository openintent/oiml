# OIML Intermediate Representation (IR)

Version: 1.0.0

## Overview

The OIML IR (Intermediate Representation) is a machine-friendly schema layer that sits between human-authored OIML YAML files and code generation. It provides a framework-agnostic, deterministic format that resolves ambiguities and normalizes intent specifications.

## Purpose

The IR layer serves several key purposes:

1. **Disambiguation**: Resolves implicit assumptions and defaults in human-authored intents
2. **Normalization**: Provides consistent type representations across all frameworks
3. **Validation**: Ensures all required information is present for code generation
4. **Framework Independence**: Decouples human intent from framework-specific implementation details
5. **Stability**: Provides a stable target for code generators to work with

## Architecture

```
Human Intent (YAML)  →  Intent Schema (Zod)  →  IR Schema  →  Code Generator  →  Generated Code
      ↓                       ↓                     ↓               ↓
  intent.yaml           Validation           Transformation    Framework-specific
                                                                 templates
```

## IR Structure

### Top-Level IR Envelope

Every intent IR follows this structure:

```typescript
interface IntentIR {
  kind: string; // Discriminator: "AddEntity", "AddField", etc.
  irVersion: "1.0.0"; // IR schema version
  provenance: ProvenanceIR; // Tracking information
  diagnostics: DiagnosticIR[]; // Non-fatal issues
  // ... intent-specific fields
}
```

### Provenance

Tracks the origin and context of the IR:

```typescript
interface ProvenanceIR {
  intentId: string; // Source intent identifier (hash, URI, filename)
  projectId: string; // Project identifier
  generatedAt: string; // ISO8601 timestamp
  model?: string; // AI model used
  sourceIntentVersion: string; // Original intent schema version
}
```

### Diagnostics

Non-fatal issues discovered during IR generation:

```typescript
interface DiagnosticIR {
  level: "Info" | "Warning" | "Error";
  code: string; // Machine-readable code
  message: string; // Human-readable message
  path?: string; // JSONPath to the issue location
}
```

## Intent IRs

### Data Intents

#### AddEntityIRV1

Creates a new database entity with full field definitions, constraints, and storage configuration.

**Key Features:**

- Resolves field types to canonical IR types
- Determines primary key strategy
- Configures storage (table name, schema, tenant scoping)
- Defines constraints (unique, indexes)
- Optional seeding configuration

**Example:**

```typescript
{
  kind: "AddEntity",
  irVersion: "1.0.0",
  provenance: { /* ... */ },
  entity: {
    name: "Issue",
    storage: {
      kind: "RelationalTable",
      tableName: "issues",
      primaryKey: { kind: "Single", field: "id" }
    },
    fields: [
      {
        name: "id",
        type: { kind: "Scalar", scalar: "UUID" },
        nullable: false,
        isPrimary: true,
        generated: { strategy: "UUID" }
      },
      {
        name: "title",
        type: { kind: "Scalar", scalar: "String" },
        nullable: false,
        validations: [{ kind: "MaxLength", max: 255 }]
      }
    ]
  },
  diagnostics: []
}
```

#### AddFieldIRV1

Adds fields to an existing entity.

#### AddRelationIRV1

Establishes relationships between entities.

#### RemoveEntityIRV1

Removes an entity from the schema.

#### RemoveFieldIRV1

Removes fields from an entity.

#### RenameEntityIRV1

Renames an entity and optionally updates references.

#### RenameFieldIRV1

Renames a field and optionally updates references.

### API Intents

#### AddEndpointIRV1

Creates a new REST API endpoint.

#### UpdateEndpointIRV1

Modifies an existing endpoint (add/remove fields, change behavior).

### Capability Intents

#### AddCapabilityIRV1

Adds a capability module (auth, file upload, SSE, websockets, etc.).

### UI Intents

#### AddComponentIRV1

Creates a UI component.

## Type System

The IR uses a normalized type system that's independent of any specific database or programming language framework:

### Scalar Types

- `String` - Variable-length text (typically 255 chars or less)
- `Text` - Long-form text
- `Int` - 32-bit integer
- `BigInt` - 64-bit integer
- `Float` - Floating point number
- `Decimal` - Fixed-precision decimal
- `Boolean` - True/false
- `DateTime` - Timestamp with time zone
- `Date` - Calendar date
- `Time` - Time of day
- `UUID` - Universally unique identifier
- `Bytes` - Binary data

### Enum Types

User-defined enumerations:

```typescript
{
  kind: "Enum",
  name: "IssueStatus",
  values: ["backlog", "todo", "in_progress", "done"],
  source: "Inline" | "Shared"
}
```

### Reference Types

Foreign key relationships:

```typescript
{
  kind: "Reference",
  targetEntity: "User",
  cardinality: "One" | "Many",
  nullable: boolean,
  onDelete: "Restrict" | "Cascade" | "SetNull",
  reverse: { /* reverse relation config */ }
}
```

### Array Types

Collections of scalar values:

```typescript
{
  kind: "Array",
  elementType: "String" | "Int" | /* other scalars */
}
```

### JSON Types

Unstructured JSON data:

```typescript
{
  kind: "Json",
  schemaRef?: string  // Optional JSON Schema reference
}
```

## Usage

### Generating IR from Intent

```typescript
import { generateIR } from "@oiml/schema/ir";
import { parseYAML } from "@oiml/schema/intent";

// 1. Parse and validate intent YAML
const intent = parseYAML(yamlContent);

// 2. Generate IR
const ir = await generateIR(intent, {
  projectId: "github.com/org/repo",
  intentId: hashContent(yamlContent)
});

// 3. Use IR for code generation
const code = await generateCode(ir, {
  framework: "prisma",
  templateVersion: "1.0.0"
});
```

### Using IR in Code Generators

Code generators should:

1. Accept IR as input (not raw intents)
2. Map IR types to framework-specific types
3. Generate idiomatic code for the target framework
4. Respect all constraints and validations in the IR

Example for Prisma:

```typescript
function mapIRTypeToPrisma(fieldType: FieldTypeIR): string {
  if (fieldType.kind === "Scalar") {
    switch (fieldType.scalar) {
      case "String":
        return "String";
      case "Int":
        return "Int";
      case "UUID":
        return "String @db.Uuid";
      // ... more mappings
    }
  }
  // ... handle other type kinds
}
```

## Versioning

The IR schema uses semantic versioning:

- **Major version**: Breaking changes to IR structure
- **Minor version**: New optional fields or intent types
- **Patch version**: Bug fixes, clarifications

Current version: `1.0.0`

## Future Enhancements

Planned features for future versions:

1. **Cross-entity constraints**: Multi-table check constraints
2. **Computed fields**: Virtual fields derived from other fields
3. **Views and materialized views**: Read-optimized projections
4. **Event sourcing**: Event-based entity definitions
5. **Graph schemas**: Support for graph databases
6. **Document schemas**: Support for document databases

## Contributing

When adding new intent types or modifying existing IRs:

1. Update the relevant TypeScript interfaces
2. Add comprehensive JSDoc comments
3. Update this README with examples
4. Bump the IR version appropriately
5. Update code generators to support the new/changed IR

## License

Apache 2.0 - See LICENSE file for details
