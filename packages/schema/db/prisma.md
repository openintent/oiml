# OpenIntent to Prisma Field Type Mapping

This document provides AI agents with comprehensive mapping rules for converting OpenIntent field types to Prisma schema syntax.

## Base Type Mappings

| OpenIntent Type | Prisma Type | PostgreSQL Type (via @db)          | Notes                                                               |
| --------------- | ----------- | ---------------------------------- | ------------------------------------------------------------------- |
| `string`        | `String`    | `VARCHAR(n)` or `TEXT`             | Use `@db.VarChar(n)` with `max_length`, or `@db.Text` for unlimited |
| `text`          | `String`    | `TEXT`                             | Always use `@db.Text` for large text fields                         |
| `integer`       | `Int`       | `INTEGER`                          | 32-bit signed integer                                               |
| `bigint`        | `BigInt`    | `BIGINT`                           | 64-bit signed integer                                               |
| `float`         | `Float`     | `REAL` or `DOUBLE PRECISION`       | Use `@db.Real` or `@db.DoublePrecision`                             |
| `decimal`       | `Decimal`   | `DECIMAL(p, s)` or `NUMERIC(p, s)` | Precision and scale can be specified                                |
| `boolean`       | `Boolean`   | `BOOLEAN`                          |                                                                     |
| `datetime`      | `DateTime`  | `TIMESTAMP`                        | Use `@db.Timestamptz` for timezone-aware                            |
| `date`          | `DateTime`  | `DATE`                             | Use `@db.Date`                                                      |
| `time`          | `DateTime`  | `TIME`                             | Use `@db.Time`                                                      |
| `uuid`          | `String`    | `UUID`                             | Must use `@db.Uuid`                                                 |
| `json`          | `Json`      | `JSONB` or `JSON`                  | Use `@db.JsonB` (preferred) or `@db.Json`                           |
| `enum`          | `Enum`      | `ENUM`                             | Requires enum definition                                            |
| `array`         | `Type[]`    | `ARRAY[]`                          | Element type specified via `array_type`                             |
| `bytes`         | `Bytes`     | `BYTEA`                            | Binary data                                                         |

## Field Attributes

### Required vs Optional

- **`required: true`** (or field not marked optional) → No `?` suffix
- **`required: false`** (or omitted) → Add `?` suffix to make field optional

### Unique Constraint

- **`unique: true`** → Add `@unique` attribute

### Max Length

- **`max_length: n`** → For `string` type, use `@db.VarChar(n)`
- If `max_length` is not specified for `string`, default to `@db.Text` or `String` without `@db` annotation

### Default Values

- **`default: value`** → Add `@default(value)` attribute
- Special defaults: `@default(now())`, `@default(uuid())`, `@default(cuid())`, etc.

## Special Cases

### String with Max Length

```prisma
// OpenIntent: { name: "email", type: "string", max_length: 255, required: true }
email String @db.VarChar(255)

// OpenIntent: { name: "description", type: "text" }
description String? @db.Text
```

### UUID Fields

```prisma
// OpenIntent: { name: "id", type: "uuid", required: true }
id String @id @default(uuid()) @db.Uuid

// OpenIntent: { name: "user_id", type: "uuid", required: true }
user_id String @db.Uuid
```

### Enum Types

```prisma
// Step 1: Define enum (before model)
enum OrderStatus {
  PENDING
  PROCESSING
  COMPLETED
  CANCELLED
}

// Step 2: Use in model
// OpenIntent: { name: "status", type: "enum", enum_values: ["pending", "processing", "completed", "cancelled"], required: true }
status OrderStatus
```

**Note**: Convert enum_values to PascalCase for Prisma enum names. Values can stay lowercase if needed.

### Array Types

```prisma
// OpenIntent: { name: "tags", type: "array", array_type: "string" }
tags String[]

// OpenIntent: { name: "user_ids", type: "array", array_type: "uuid" }
user_ids String[] @db.Uuid

// OpenIntent: { name: "scores", type: "array", array_type: "integer" }
scores Int[]

// OpenIntent: { name: "prices", type: "array", array_type: "decimal" }
prices Decimal[]
```

### Date/Time Types

```prisma
// OpenIntent: { name: "created_at", type: "datetime", required: true }
created_at DateTime @default(now())

// OpenIntent: { name: "birthday", type: "date" }
birthday DateTime? @db.Date

// OpenIntent: { name: "opening_time", type: "time" }
opening_time DateTime? @db.Time

// OpenIntent: { name: "updated_at", type: "datetime", required: true }
updated_at DateTime @updatedAt
```

### JSON Fields

```prisma
// OpenIntent: { name: "metadata", type: "json" }
metadata Json? @db.JsonB

// OpenIntent: { name: "preferences", type: "json", required: true }
preferences Json @db.JsonB
```

### Decimal with Precision

```prisma
// OpenIntent: { name: "price", type: "decimal", required: true }
price Decimal

// For specific precision (if specified in OpenIntent, use @db.Decimal(p, s))
// price Decimal @db.Decimal(10, 2)
```

### Bytes/Binary Data

```prisma
// OpenIntent: { name: "avatar", type: "bytes" }
avatar Bytes?
```

## Complete Example

### OpenIntent Field Spec:

```yaml
fields:
  - name: id
    type: uuid
    required: true

  - name: email
    type: string
    max_length: 255
    required: true
    unique: true

  - name: bio
    type: text
    required: false

  - name: age
    type: integer
    required: false

  - name: balance
    type: decimal
    required: true

  - name: is_active
    type: boolean
    required: true
    default: true

  - name: created_at
    type: datetime
    required: true

  - name: tags
    type: array
    array_type: string

  - name: status
    type: enum
    enum_values: ["pending", "active", "suspended"]
    required: true

  - name: metadata
    type: json
    required: false
```

### Generated Prisma Schema:

```prisma
enum UserStatus {
  PENDING
  ACTIVE
  SUSPENDED
}

model User {
  id        String      @id @default(uuid()) @db.Uuid
  email     String      @unique @db.VarChar(255)
  bio       String?     @db.Text
  age       Int?
  balance   Decimal
  is_active Boolean     @default(true)
  created_at DateTime   @default(now())
  tags      String[]
  status    UserStatus
  metadata  Json?       @db.JsonB

  @@map("users")
}
```

## Generation Rules Summary

1. **Always add `@map("table_name")`** to the model (convert entity name to snake_case plural)
2. **Primary Key**: If `id` field with `uuid` type, use `@id @default(uuid()) @db.Uuid`
3. **Timestamps**: Common pattern `created_at DateTime @default(now())` and `updated_at DateTime @updatedAt`
4. **Nullable fields**: Add `?` suffix when `required` is false or omitted
5. **Enum conversion**: Convert enum_values to PascalCase for enum name
6. **Array syntax**: Use `Type[]` where Type is the Prisma type for the array_type
7. **Database-specific types**: Use `@db.*` annotations for PostgreSQL-specific types

## Edge Cases & Notes

- **String vs Text**: Use `@db.VarChar(n)` with `max_length`, otherwise `@db.Text` or plain `String`
- **UUID as String**: Always remember to add `@db.Uuid` when type is uuid
- **Enum definitions**: Must be defined before the model that uses them
- **Array of UUIDs**: Use `String[] @db.Uuid` (Prisma limitation)
- **Json vs JsonB**: Prefer `@db.JsonB` for better performance in PostgreSQL
- **Time zones**: Use `@db.Timestamptz` for timezone-aware timestamps if needed
