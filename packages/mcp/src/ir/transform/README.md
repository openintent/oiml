# Intent to IR Transformation

This directory contains transformation logic for converting human-authored OIML intents (validated YAML) to normalized IR (Intermediate Representation) format.

## Purpose

The transformation layer:

1. **Resolves ambiguities** in human-authored intents
2. **Normalizes types** to IR canonical formats
3. **Infers defaults** where not explicitly specified
4. **Validates semantic constraints** beyond schema validation
5. **Generates diagnostics** for potential issues

## Architecture

```
┌─────────────────┐
│   Intent YAML   │  Human-authored, validated against Zod schema
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Transform      │  Convert to IR, resolve ambiguities
│  Layer          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Intent IR     │  Machine-friendly, deterministic
└─────────────────┘
```

## Transformation Rules

### Field Type Resolution

Human intent types → IR types:

| Intent Type | IR Type                                  | Notes                |
| ----------- | ---------------------------------------- | -------------------- |
| `string`    | `{ kind: "Scalar", scalar: "String" }`   | Variable-length text |
| `text`      | `{ kind: "Scalar", scalar: "Text" }`     | Long-form text       |
| `integer`   | `{ kind: "Scalar", scalar: "Int" }`      | 32-bit integer       |
| `bigint`    | `{ kind: "Scalar", scalar: "BigInt" }`   | 64-bit integer       |
| `float`     | `{ kind: "Scalar", scalar: "Float" }`    | Floating point       |
| `decimal`   | `{ kind: "Scalar", scalar: "Decimal" }`  | Fixed precision      |
| `boolean`   | `{ kind: "Scalar", scalar: "Boolean" }`  | True/false           |
| `datetime`  | `{ kind: "Scalar", scalar: "DateTime" }` | Timestamp            |
| `date`      | `{ kind: "Scalar", scalar: "Date" }`     | Calendar date        |
| `time`      | `{ kind: "Scalar", scalar: "Time" }`     | Time of day          |
| `uuid`      | `{ kind: "Scalar", scalar: "UUID" }`     | UUID                 |
| `bytes`     | `{ kind: "Scalar", scalar: "Bytes" }`    | Binary data          |
| `json`      | `{ kind: "Json" }`                       | Unstructured JSON    |
| `enum`      | `{ kind: "Enum", ... }`                  | Enumeration          |
| `array`     | `{ kind: "Array", ... }`                 | Array of scalars     |

### Default Inference

The transformation layer infers defaults for:

#### Primary Key

- If no field has `id` or `primary` attribute, a UUID `id` field is added automatically
- Single `id` field becomes primary key
- Multiple fields with `primary` attribute create composite primary key

#### Table Name

- Entity name converted to snake_case and pluralized
- Example: `Issue` → `issues`, `BlogPost` → `blog_posts`

#### Field Nullability

- Fields without `required: true` are nullable by default
- Fields with `required: false` are explicitly nullable
- Primary key fields are never nullable

#### Foreign Key Constraints

- Relations without explicit `onDelete` default to `Restrict`
- `many_to_one` relations without foreign key details infer standard pattern

#### Indexes

- Foreign key fields automatically get indexes
- Enum fields get indexes by default
- Fields marked `unique: true` get unique constraints

### Validation Rules

Beyond schema validation, the transformation layer checks:

1. **Entity name conflicts** with reserved words
2. **Field name conflicts** within the same entity
3. **Circular references** in relations
4. **Orphaned foreign keys** (target entity doesn't exist)
5. **Type mismatches** in relations (FK type != target PK type)

### Diagnostic Codes

Diagnostics use the following codes:

- **`IR001`**: Info - Inferred primary key
- **`IR002`**: Info - Inferred table name
- **`IR003`**: Info - Inferred index
- **`IR010`**: Warning - Missing relation reverse
- **`IR011`**: Warning - Potential naming conflict
- **`IR020`**: Error - Invalid foreign key reference
- **`IR021`**: Error - Type mismatch in relation
- **`IR022`**: Error - Circular dependency detected

## Usage

```typescript
import { transformAddEntity } from "@oiml/schema/ir/transform";
import { parseIntentYAML } from "@oiml/schema/intent";

// 1. Parse and validate human-authored YAML
const intent = parseIntentYAML(yamlContent);
const addEntityIntent = intent.intents[0]; // First intent

// 2. Transform to IR
const ir = await transformAddEntity(addEntityIntent, {
  projectId: "github.com/org/repo",
  intentId: hashContent(yamlContent),
  existingEntities: ["User", "Workspace"] // For validation
});

// 3. Check diagnostics
if (ir.diagnostics.some(d => d.level === "Error")) {
  console.error("Transform failed with errors:", ir.diagnostics);
  return;
}

// 4. Use IR for code generation
const code = await generateCode(ir);
```

## Extension Points

To add transformation logic for custom field types or attributes:

1. Create a new transformer in `transformers/`
2. Register it in the transformation pipeline
3. Add test cases in `__tests__/`
4. Update this README with the new rules

## Testing

Transformers should be thoroughly tested with:

- **Happy path**: Standard valid intents
- **Edge cases**: Empty arrays, minimal intents, maximal intents
- **Error cases**: Invalid references, type mismatches
- **Inference**: Verify default inference works correctly

Run tests:

```bash
pnpm test ir/transform
```
