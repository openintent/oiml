# Intent Transformers

This directory contains transformers that convert OIML intent specifications to validated IR format.

## Available Transformers

### ✅ `transformAddEntity`

Transforms an `add_entity` intent to `AddEntityIRV1` IR.

**Features:**

- ✅ Resolves field types to IR canonical types
- ✅ Infers primary keys automatically
- ✅ Generates table names (with pluralization)
- ✅ Validates field names against SQL reserved keywords
- ✅ Auto-generates indexes for foreign keys
- ✅ Collects diagnostics (Info, Warning, Error)
- ✅ Validates output with Zod schemas

## Usage

### Basic Usage

```typescript
import { transformAddEntity } from "@oiml/schema/ir/transform";

const addEntityIntent = {
  kind: "add_entity",
  scope: "data",
  entity: "User",
  fields: [
    { name: "id", type: "integer", required: true },
    { name: "email", type: "string", required: true, unique: true }
  ]
};

const ir = transformAddEntity(addEntityIntent, {
  projectId: "github.com/org/repo",
  intentId: "sha256:abc123",
  oimlVersion: "0.1.0"
});

console.log(ir.entity.name); // "User"
console.log(ir.entity.storage.tableName); // "users"
console.log(ir.diagnostics); // Array of diagnostic messages
```

### With Full Context

```typescript
import { transformAddEntity, TransformContext } from "@oiml/schema/ir/transform";

const context: TransformContext = {
  projectId: "github.com/org/repo",
  intentId: "sha256:abc123def456",
  oimlVersion: "0.1.0",
  model: "claude-sonnet-4.5",
  existingEntities: ["User", "Post"] // For validation
};

try {
  const ir = transformAddEntity(intent, context);
  console.log("✅ Transformation successful!");
  console.log(`Generated ${ir.entity.fields.length} fields`);
} catch (error) {
  console.error("❌ Transformation failed:", error.message);
  if (error.diagnostics) {
    error.diagnostics.forEach(d => {
      console.error(`[${d.level}] ${d.message}`);
    });
  }
}
```

### Error Handling

```typescript
import { transformAddEntity } from "@oiml/schema/ir/transform";

try {
  const ir = transformAddEntity(intent, context);

  // Check for warnings
  const warnings = ir.diagnostics.filter(d => d.level === "Warning");
  if (warnings.length > 0) {
    console.warn("⚠️  Warnings during transformation:");
    warnings.forEach(w => console.warn(`  - ${w.message}`));
  }

  // Check for errors
  const errors = ir.diagnostics.filter(d => d.level === "Error");
  if (errors.length > 0) {
    throw new Error("Transformation completed with errors");
  }

  return ir;
} catch (error) {
  console.error("Failed to transform intent:", error);
  throw error;
}
```

## Transformation Features

### Field Type Resolution

```typescript
// Intent field types → IR field types
"string"   → { kind: "Scalar", scalar: "String" }
"text"     → { kind: "Scalar", scalar: "Text" }
"integer"  → { kind: "Scalar", scalar: "Int" }
"uuid"     → { kind: "Scalar", scalar: "UUID" }
"datetime" → { kind: "Scalar", scalar: "DateTime" }
"enum"     → { kind: "Enum", name: "...", values: [...] }
"array"    → { kind: "Array", elementType: "..." }
```

### Primary Key Inference

The transformer automatically detects primary keys:

1. Fields named `id`
2. Fields with `default: "autoincrement"`
3. Fields with `primary` or `id` attributes
4. First field if no candidates found (with warning)

### Table Naming

Entity names are converted to table names:

```typescript
"User"      → "users"
"BlogPost"  → "blog_posts"
"Category"  → "categories"
"Person"    → "people" (irregular plural)
```

### Auto-Generated Indexes

Indexes are automatically created for:

- Foreign key fields
- Unique constraint fields
- Fields specified in `indexes` array

### Validation Rules

The transformer validates:

✅ **Entity names** - Not reserved SQL keywords  
✅ **Field names** - Unique within entity, not reserved keywords  
✅ **Field types** - Valid OIML types  
✅ **Primary keys** - At least one field  
✅ **Zod schema** - Final IR structure

### Diagnostic Codes

| Code  | Level   | Description           |
| ----- | ------- | --------------------- |
| IR001 | Info    | Inferred primary key  |
| IR002 | Info    | Inferred table name   |
| IR003 | Info    | Auto-added index      |
| IR011 | Warning | Reserved keyword used |
| IR020 | Error   | Duplicate field name  |
| IR021 | Error   | Invalid field type    |
| IR099 | Error   | Zod validation failed |

## Testing

```bash
# Run the test suite
cd packages/schema
pnpm exec tsx ir/examples/test.ts
```

## Next Steps

### Adding More Transformers

To add a new transformer:

1. Create `transformers/{intent-type}.ts`
2. Export the transformer function
3. Add tests in `__tests__/`
4. Export from `transform/index.ts`
5. Update this README

Example structure:

```typescript
// transformers/add-field.ts
export function transformAddField(intent: any, context: TransformContext): AddFieldIRV1 {
  const diagnostics = new DiagnosticCollector();

  // Transformation logic...

  return AddFieldIRV1.parse(ir);
}
```

### Available Transformers

#### Data Intents

- ✅ `transformAddEntity` - Create new database entities
- ✅ `transformAddField` - Add fields to existing entity
- ✅ `transformAddRelation` - Add relationships between entities
- ✅ `transformRemoveEntity` - Remove entities
- ✅ `transformRemoveField` - Remove fields from entities
- ✅ `transformRenameEntity` - Rename entities
- ✅ `transformRenameField` - Rename fields

#### API Intents

- ✅ `transformAddEndpoint` - Create API endpoints
- ✅ `transformUpdateEndpoint` - Update API endpoints

#### Capability Intents

- ✅ `transformAddCapability` - Add capability modules (auth, file upload, etc.)

#### UI Intents

- ✅ `transformAddComponent` - Create UI components

## Resources

- [IR Schema Documentation](../../README.md)
- [Transformation Utilities](../utils.ts)
- [Transform Types](../types.ts)
- [Examples](../../examples/)

---

**Version:** 1.0.0  
**Last Updated:** November 17, 2025
