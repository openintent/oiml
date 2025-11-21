# OIML Implementation Plan Schema v0.1.0

This schema defines the structure for OIML implementation plans - standardized documents that AI agents create to communicate their intended changes **before** executing an OIML intent.

## Purpose

Implementation plans provide:

- **Transparency**: Users can review planned changes before execution
- **Validation**: Plans can be validated against this schema
- **Risk Assessment**: Automated risk analysis of planned changes
- **Dependency Tracking**: Understanding change dependencies and execution order
- **Auditing**: Track what was planned vs. what was actually executed (plan.yaml vs. summary.yaml)

## Schema Artifacts

This schema is available in two formats:

- `schema.json` - JSON Schema (Draft-07) for validation with Ajv, JSON Schema validators
- `schema.zod.js` - Zod schema for TypeScript/JavaScript validation and type inference

## Installation

### Via GitHub Container Registry

```bash
# Pull the schema image
docker pull ghcr.io/openintent/schemas/oiml.plan:0.1.0

# Extract schema files
docker create --name plan-schema ghcr.io/openintent/schemas/oiml.plan:0.1.0
docker cp plan-schema:/schema.json ./schema.json
docker cp plan-schema:/schema.zod.js ./schema.zod.js
docker cp plan-schema:/metadata.json ./metadata.json
docker rm plan-schema
```

### Via NPM Package

```bash
npm install @oiml/schema
```

Then import:

```javascript
// JSON Schema
import schema from "@oiml/schema/schemas/oiml.plan/0.1.0/schema.json" assert { type: "json" };

// Zod Schema
import { ImplementationPlan } from "@oiml/schema/schemas/oiml.plan/0.1.0/schema.zod.js";
```

## Usage

### Validation with Zod (TypeScript/JavaScript)

```typescript
import { ImplementationPlan } from "@oiml/schema/schemas/oiml.plan/0.1.0/schema.zod.js";
import YAML from "yaml";
import fs from "fs";

// Read and parse plan file
const planContent = fs.readFileSync(".oiml/intents/FEAT-123/plan.yaml", "utf8");
const planData = YAML.parse(planContent);

// Validate
const result = ImplementationPlan.safeParse(planData);

if (result.success) {
  console.log("✓ Plan is valid");
  const plan = result.data;
  // Use the validated plan
} else {
  console.error("✗ Plan is invalid:", result.error.issues);
}
```

### Validation with Ajv (Any Language)

```javascript
import Ajv from "ajv";
import addFormats from "ajv-formats";
import schema from "./schema.json" assert { type: "json" };

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validate = ajv.compile(schema);

if (validate(planData)) {
  console.log("✓ Plan is valid");
} else {
  console.error("✗ Plan is invalid:", validate.errors);
}
```

## Schema Structure

### Top-Level Fields

```yaml
version: 0.1.0 # Schema version (required)
created_at: 2025-11-21... # ISO8601 timestamp (required)
intent_id: FEAT-123 # Intent identifier (required)
project_id: my-project # Project identifier (optional)
model: claude-sonnet-4.5 # AI model (optional)
intents_to_process: 1 # Number of intents (required, min: 1)
template_used: { ... } # Template pack info (required)
steps: [...] # Processing steps (required, min: 1)
planned_changes: [...] # All file changes (required, min: 1)
risk_assessment: { ... } # Risk analysis (optional)
warnings: [...] # Warnings (optional)
prerequisites: { ... } # Prerequisites (optional)
estimated_duration: "..." # Duration estimate (optional)
```

### Key Components

#### PlannedChange

Represents a single file change:

```yaml
file: prisma/schema.prisma # Relative path (required)
action: modify # create|modify|delete|regenerate (required)
description: Add Post model... # Description (required)
steps: [...] # Detailed steps (optional)
dependencies: [...] # File dependencies (optional)
```

#### IntentStep

Represents processing of one intent:

```yaml
kind: add_entity # Intent kind (required)
scope: data # data|api|ui|capability (required)
target: Post # Target name (required)
description: Create Post entity... # Description (required)
changes: [...] # Planned changes (required)
```

#### RiskAssessment

Risk analysis of planned changes:

```yaml
level: low # low|medium|high (required)
factors: [...] # Risk factors (required)
mitigations: [...] # Mitigation strategies (optional)
```

## Example Plan File

See the [PLAN.md documentation](https://github.com/openintent/oiml-mcp/blob/main/src/ir/PLAN.md) for a complete example plan file.

```yaml
version: 0.1.0
created_at: 2025-11-21T19:30:00Z
intent_id: FEAT-123
intents_to_process: 1

template_used:
  framework: prisma
  category: database
  pack: oiml://templates/database/prisma/1.0.0
  version: 1.0.0

steps:
  - kind: add_entity
    scope: data
    target: Post
    description: Create Post entity with fields
    changes:
      - file: prisma/schema.prisma
        action: modify
        description: Add Post model
      - file: prisma/migrations/.../migration.sql
        action: create
        description: Generate migration SQL
        dependencies:
          - prisma/schema.prisma

planned_changes:
  - file: prisma/schema.prisma
    action: modify
    description: Add Post model
  - file: prisma/migrations/.../migration.sql
    action: create
    description: Generate migration SQL

risk_assessment:
  level: low
  factors:
    - Database schema modification
  mitigations:
    - Migration can be rolled back
```

## Compatibility

- **Minimum Zod**: 3.24.0
- **Minimum Ajv**: 8.0.0
- **JSON Schema**: Draft-07

## Versioning

This is version **0.1.0** of the implementation plan schema.

Schema versions follow semantic versioning:

- **Major**: Breaking changes to schema structure
- **Minor**: Backward-compatible additions
- **Patch**: Backward-compatible fixes

## Related Documentation

- [Implementation Plan Guide](https://github.com/openintent/oiml-mcp/blob/main/src/ir/PLAN.md) - Complete usage guide for AI agents
- [OIML IR Documentation](https://github.com/openintent/oiml-mcp/blob/main/src/ir/README.md) - Intermediate Representation docs
- [OIML Schema Package](https://www.npmjs.com/package/@oiml/schema) - All OIML schemas

## License

Apache 2.0
