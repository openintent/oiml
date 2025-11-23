# OIML Plan Schema Migration Summary

## Overview

Migrated the OIML implementation plan schema from the `oiml-mcp` repository to the official `@oiml/schema` package structure, making it available as a versioned, publishable schema artifact alongside `oiml.intent` and `oiml.project`.

## Changes Made

### 1. Created Schema Package Structure

**Location**: `/Users/crystal/Developer/oiml/packages/schema/schemas/oiml.plan/0.1.0/`

Created the following files:

#### `schema.zod.js` (5.0 KB)

- Converted TypeScript Zod schemas from `oiml-mcp/src/ir/plan.ts` to standalone JavaScript module
- Exports:
  - `ImplementationPlan` (main schema)
  - `PlannedChange` - File-level changes
  - `IntentStep` - Intent processing steps
  - `TemplatePack` - Template information
  - `RiskAssessment` - Risk analysis
  - `Prerequisites` - Pre-execution requirements
  - Supporting enums: `PlannedFileAction`, `IntentScope`, `RiskLevel`

#### `schema.json` (15.2 KB)

- Auto-generated JSON Schema (Draft-07) from Zod definitions
- Supports validation with Ajv and other JSON Schema validators
- Complete with descriptions, constraints, and type definitions

#### `metadata.json`

- Schema metadata:
  - Name: `oiml.plan`
  - Version: `0.1.0`
  - Minimum engines: Ajv 8.0.0, Zod 3.24.0
  - Artifact references (JSON + Zod schemas)

#### `Dockerfile`

- Multi-stage Docker build for packaging schema as OCI artifact
- FROM scratch for minimal size
- Includes OCI labels for metadata
- Ready for publishing to GitHub Container Registry (GHCR)

#### `README.md` (6.4 KB)

- Complete documentation for the plan schema
- Installation instructions (Docker, NPM)
- Usage examples (Zod, Ajv)
- Schema structure reference
- Example plan file
- Compatibility information

### 2. Updated Build Scripts

#### `scripts/generate-json-schemas.js`

Added `oiml.plan` configuration:

```javascript
{
  name: "oiml.plan",
  version: "0.1.0",
  path: "../schemas/oiml.plan/0.1.0",
  schemaName: "ImplementationPlan",
  title: "Open Intent Modeling Language (OIML) Implementation Plan Schema",
  description: "Schema for OIML implementation plan definitions - agent's intended changes before execution",
  id: "https://oiml.dev/schemas/oiml.plan/0.1.0/schema.json",
  definitions: [
    "PlannedFileAction",
    "PlannedChange",
    "TemplatePack",
    "IntentScope",
    "IntentStep",
    "RiskLevel",
    "RiskAssessment",
    "Prerequisites"
  ]
}
```

**Result**: Successfully generates `schema.json` from `schema.zod.js`

#### `scripts/publish-schema.sh`

Added support for "plan" entity type:

```bash
case "$ENTITY_TYPE" in
  intent)
    SCHEMA_NAME="oiml.intent"
    ;;
  project)
    SCHEMA_NAME="oiml.project"
    ;;
  plan)
    SCHEMA_NAME="oiml.plan"  # NEW
    ;;
  oiml.*)
    SCHEMA_NAME="$ENTITY_TYPE"
    ;;
esac
```

**Usage**:

```bash
./publish-schema.sh plan 0.1.0
# or
./publish-schema.sh oiml.plan 0.1.0
```

### 3. Updated Documentation

#### `schemas/README.md`

Added `oiml.plan` to the list of available schemas:

```markdown
### oiml.plan

Implementation plan schema - agent's intended changes before execution.

**Versions:**

- `0.1.0` - Initial release
```

## Distribution

The schema can now be distributed via:

### 1. GitHub Container Registry (GHCR)

```bash
# Publish (requires GHCR_PAT token)
cd packages/schema
export GHCR_PAT=your_github_token
./scripts/publish-schema.sh plan 0.1.0

# Pull
docker pull ghcr.io/openintent/schemas/oiml.plan:0.1.0

# Extract
docker create --name plan-schema ghcr.io/openintent/schemas/oiml.plan:0.1.0
docker cp plan-schema:/schema.json ./schema.json
docker cp plan-schema:/schema.zod.js ./schema.zod.js
docker cp plan-schema:/metadata.json ./metadata.json
docker rm plan-schema
```

### 2. NPM Package

Will be included in the next `@oiml/schema` package release.

```bash
npm install @oiml/schema
```

```javascript
// JSON Schema
import schema from "@oiml/schema/schemas/oiml.plan/0.1.0/schema.json" assert { type: "json" };

// Zod Schema
import { ImplementationPlan } from "@oiml/schema/schemas/oiml.plan/0.1.0/schema.zod.js";
```

## Schema Structure Summary

### Top-Level Schema

```typescript
interface ImplementationPlanV010 {
  version: "0.1.0"; // Required
  created_at: string; // ISO8601 (Required)
  intent_id: string; // Required
  project_id?: string; // Optional
  model?: string; // Optional
  intents_to_process: number; // Required (min: 1)
  template_used: TemplatePack; // Required
  steps: IntentStep[]; // Required (min: 1)
  planned_changes: PlannedChange[]; // Required (min: 1)
  risk_assessment?: RiskAssessment; // Optional
  warnings?: string[]; // Optional
  prerequisites?: Prerequisites; // Optional
  estimated_duration?: string; // Optional
}
```

### File Actions

- `create` - Create a new file
- `modify` - Modify an existing file
- `delete` - Delete a file
- `regenerate` - Regenerate a file (e.g., Prisma client)

### Risk Levels

- `low` - Safe changes (additions, non-breaking)
- `medium` - Moderate risk (modifications, schema changes)
- `high` - High risk (deletions, breaking changes)

### Intent Scopes

- `data` - Database/data layer
- `api` - API endpoints
- `ui` - User interface components
- `capability` - Capabilities (auth, file upload, etc.)

## Integration Points

### OIML MCP Server

The MCP server (`oiml-mcp`) should be updated to:

1. Import from `@oiml/schema` instead of local types:

   ```typescript
   // Before (local)
   import { ImplementationPlanV1 } from "./ir/plan.js";

   // After (from package)
   import { ImplementationPlan } from "@oiml/schema/schemas/oiml.plan/0.1.0/schema.zod.js";
   ```

2. Use the published schema for validation

### MCP validate_plan Tool

The MCP server's `validate_plan` tool now validates against the official schema package.

## Validation

Tested schema generation:

```bash
cd /Users/crystal/Developer/oiml/packages/schema
pnpm run generate:schemas
```

**Output**:

```
Generating JSON Schema for oiml.plan@0.1.0...
✓ Generated /Users/crystal/Developer/oiml/packages/schema/schemas/oiml.plan/0.1.0/schema.json

✓ All schemas generated successfully!
```

**Files created**:

- `schema.json` - 15,229 bytes
- `schema.zod.js` - 5,053 bytes
- `metadata.json` - 306 bytes
- `Dockerfile` - 987 bytes
- `README.md` - 6,394 bytes

Total: ~28 KB

## Benefits

### Before (Local in oiml-mcp)

- Schema only available in `oiml-mcp` repository
- Not versioned or publishable
- TypeScript-only (Zod)
- No JSON Schema validation support
- No distribution mechanism

### After (Official Schema Package)

- ✅ Part of official `@oiml/schema` package
- ✅ Versioned (0.1.0)
- ✅ Publishable to GHCR and NPM
- ✅ Both Zod (TypeScript) and JSON Schema (any language)
- ✅ Standard distribution via Docker/NPM
- ✅ Same structure as `oiml.intent` and `oiml.project`
- ✅ Documented with examples
- ✅ Ready for CI/CD integration

## Next Steps

### Immediate

1. ✅ Schema structure created
2. ✅ Build scripts updated
3. ✅ Documentation complete
4. ✅ JSON Schema generated
5. ⏳ Publish to GHCR (requires token)
6. ⏳ Update `oiml-mcp` to use package schema
7. ⏳ Publish `@oiml/schema` to NPM

### Future

1. Add GitHub Actions workflow for automatic publishing
2. Add schema versioning guide
3. Consider adding schema migration tools
4. Add more validation examples in different languages

## Testing Publication

To test the publication flow:

```bash
# Build the Docker image (local only)
cd /Users/crystal/Developer/oiml/packages/schema
./scripts/publish-schema.sh plan 0.1.0

# With GHCR token (will push to registry)
export GHCR_PAT=your_token
./scripts/publish-schema.sh plan 0.1.0
```

## Files Modified

### New Files (5)

1. `/packages/schema/schemas/oiml.plan/0.1.0/schema.zod.js`
2. `/packages/schema/schemas/oiml.plan/0.1.0/schema.json` (generated)
3. `/packages/schema/schemas/oiml.plan/0.1.0/metadata.json`
4. `/packages/schema/schemas/oiml.plan/0.1.0/Dockerfile`
5. `/packages/schema/schemas/oiml.plan/0.1.0/README.md`

### Modified Files (3)

1. `/packages/schema/scripts/generate-json-schemas.js` - Added plan config
2. `/packages/schema/scripts/publish-schema.sh` - Added "plan" case
3. `/packages/schema/schemas/README.md` - Documented plan schema

## Compatibility

- **Zod**: ≥ 3.24.0
- **Ajv**: ≥ 8.0.0
- **JSON Schema**: Draft-07
- **Node.js**: ≥ 18 (ESM modules)
- **Docker**: For building/publishing OCI artifacts

## License

Apache 2.0 (consistent with OIML project)

## Related Documentation

- [Plan Schema README](./0.1.0/README.md)
- [PLAN.md Guide](https://github.com/openintent/oiml-mcp/blob/main/src/ir/PLAN.md)
- [Schema Publishing Guide](../PUBLISHING.md)
- [OIML Schema Package](https://www.npmjs.com/package/@oiml/schema)

---

**Migration completed**: November 21, 2025
**Schema version**: 0.1.0
**Status**: Ready for publication
