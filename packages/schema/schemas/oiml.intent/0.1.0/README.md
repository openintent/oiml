# OIML Intent Schema v0.1.0

Open Intent Modeling Language (OIML) Intent Schema - Version 0.1.0

## Contents

This package contains:

- **`schema.json`** - JSON Schema (Draft-07) - The authoritative schema for validation with AJV or similar
- **`schema.zod.js`** - Zod schema definitions - Runtime validation for TypeScript/JavaScript
- **`metadata.json`** - Schema metadata including version, engine requirements, and artifact references
- **`Dockerfile`** - OCI artifact packaging for GHCR distribution

## Installation

### Via GitHub Container Registry (Recommended)

```bash
# Pull the schema image
docker pull ghcr.io/openintent/schemas/oiml.intent:0.1.0

# Extract files
docker create --name temp ghcr.io/openintent/schemas/oiml.intent:0.1.0
docker cp temp:/schema.json ./schema.json
docker cp temp:/schema.zod.js ./schema.zod.js
docker cp temp:/metadata.json ./metadata.json
docker rm temp
```

### Via NPM

```bash
npm install @oiml/schema
```

```javascript
import { Intent } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import schema from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.json";
```

## Usage

### With Zod (TypeScript/JavaScript)

```javascript
import { Intent, AddEntity, Field } from './schema.zod.js';

// Validate an intent document
const doc = {
  version: "0.1.0",
  intents: [{
    kind: "add_entity",
    scope: "data",
    entity: "User",
    fields: [{
      name: "email",
      type: "string",
      required: true
    }]
  }]
};

// Parse and validate
const result = Intent.safeParse(doc);
if (result.success) {
  console.log("Valid!", result.data);
} else {
  console.error("Invalid:", result.error);
}

// TypeScript type inference
import type { z } from 'zod';
type IntentDoc = z.infer<typeof Intent>;
```

### With AJV (JSON Schema)

```javascript
import Ajv from "ajv";
import schema from "./schema.json" assert { type: "json" };

const ajv = new Ajv();
const validate = ajv.compile(schema);

const doc = {
  version: "0.1.0",
  intents: [
    /* ... */
  ]
};

if (validate(doc)) {
  console.log("Valid!");
} else {
  console.error("Invalid:", validate.errors);
}
```

### With Python (JSON Schema)

```python
import json
import jsonschema

with open('schema.json') as f:
    schema = json.load(f)

doc = {
    "version": "0.1.0",
    "intents": [...]
}

jsonschema.validate(doc, schema)
```

## Schema Structure

### Top-Level Document (Intent)

```typescript
{
  version: string;        // Semver (e.g., "0.1.0")
  ai_context?: {          // Optional AI agent context
    purpose?: string;
    instructions?: string;
    references?: Array<{kind: "file", path: string}>;
  };
  provenance?: {          // Optional provenance tracking
    created_by?: {type: "human"|"agent"|"system", name?: string, id?: string};
    created_at?: string;  // ISO8601 UTC
    source?: string;
    model?: string;
  };
  intents: Intent[];      // Array of intent objects (min 1)
}
```

### Intent Types

All intents supported in this version:

- **`AddEntity`** - Add a new data entity
- **`AddField`** - Add fields to an existing entity
- **`RemoveField`** - Remove fields from an entity
- **`AddEndpoint`** - Add an API endpoint
- **`AddComponent`** - Add a UI component
- **`AddRelation`** - Add relationships between entities

### Field Types

Supported field types:

`string`, `text`, `integer`, `bigint`, `float`, `decimal`, `boolean`, `datetime`, `date`, `time`, `uuid`, `json`, `enum`, `array`, `bytes`

## Examples

### Add Entity

```yaml
version: "0.1.0"
intents:
  - kind: add_entity
    scope: data
    entity: User
    fields:
      - name: id
        type: uuid
        required: true
      - name: email
        type: string
        required: true
        unique: true
      - name: name
        type: string
        required: true
```

### Add Relation

```yaml
version: "0.1.0"
intents:
  - kind: add_relation
    scope: schema
    relation:
      source_entity: Post
      target_entity: User
      kind: many_to_one
      field_name: author
      foreign_key:
        local_field: authorId
        target_field: id
      reverse:
        field_name: posts
        kind: one_to_many
```

### Add Endpoint

```yaml
version: "0.1.0"
intents:
  - kind: add_endpoint
    scope: api
    method: GET
    path: /api/users
    entity: User
    fields:
      - name: id
        type: uuid
      - name: email
        type: string
```

## Version Information

- **Version**: 0.1.0
- **Status**: Stable
- **Minimum Engine Versions**:
  - AJV: 8.0.0
  - Zod: 3.24.0

## License

Apache 2.0

## Links

- **Documentation**: https://oiml.dev
- **Repository**: https://github.com/openintent/oiml
- **Package Registry**: https://github.com/orgs/openintent/packages
- **Issues**: https://github.com/openintent/oiml/issues

