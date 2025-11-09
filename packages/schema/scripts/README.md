# Schema Generation Scripts

## Overview

This directory contains scripts for generating JSON Schema files from Zod schema definitions.

## Scripts

### `generate-json-schemas.js`

Automatically generates `schema.json` files from `schema.zod.js` files for all schema versions.

**Usage:**

```bash
pnpm run generate:schemas
```

**What it does:**

1. Reads the Zod schema definitions from `schemas/{name}/{version}/schema.zod.js`
2. Converts them to JSON Schema (Draft-07) using `zod-to-json-schema`
3. Adds proper metadata fields (`$schema`, `$id`, `title`, `description`)
4. Writes the result to `schemas/{name}/{version}/schema.json`

**Why this approach?**

- **Single Source of Truth**: The Zod schema (`schema.zod.js`) is the authoritative definition
- **Type Safety**: Zod provides runtime validation and TypeScript type inference
- **Automatic Sync**: JSON Schema is generated automatically, eliminating manual sync issues
- **Validation Support**: Both engines (Zod and AJV) can use their preferred format

## Adding a New Schema Version

To add a new schema version:

1. Create the directory: `schemas/{name}/{version}/`
2. Create `schema.zod.js` with your Zod definitions
3. Create `metadata.json` with version metadata
4. Update `generate-json-schemas.js` to include the new version in the `schemas` array
5. Run `pnpm run generate:schemas` to generate the JSON Schema

## Schema Structure

Each schema version should have:

```
schemas/
  └── {name}/
      └── {version}/
          ├── schema.zod.js   # Source of truth (Zod definitions)
          ├── schema.json     # Generated (JSON Schema)
          └── metadata.json   # Version metadata
```

### Example metadata.json

```json
{
  "name": "oiml.intent",
  "version": "0.1.0",
  "digest": "sha256-<filled by build>",
  "engines_min": {
    "ajv": "8.0.0",
    "zod": "3.24.0"
  },
  "deprecated": false,
  "replaces": null,
  "artifacts": {
    "json_schema": "schema.json",
    "zod_schema": "schema.zod.js"
  },
  "signatures": []
}
```

## Publishing

### NPM Package

The generated schemas are included in the published npm package and can be imported:

```javascript
// For Zod validation
import { Intent } from '@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js';

// For JSON Schema (with AJV or similar)
import schema from '@oiml/schema/schemas/oiml.intent/0.1.0/schema.json';
```

### GitHub Container Registry

Schemas are also published as OCI artifacts to GHCR for broader distribution:

```bash
# Publish manually
cd packages/schema
./scripts/publish-schema.sh oiml.intent 0.1.0

# Or let GitHub Actions handle it automatically on push
```

See [`../schemas/README.md`](../schemas/README.md) for detailed GHCR usage.

