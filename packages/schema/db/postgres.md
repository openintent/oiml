# OpenIntent to PostgreSQL Field Type Mapping

This document provides AI agents with comprehensive mapping rules for converting OpenIntent field types directly to PostgreSQL SQL DDL (Data Definition Language) syntax.

## Base Type Mappings

| OpenIntent Type | PostgreSQL Type                    | Notes                                                 |
| --------------- | ---------------------------------- | ----------------------------------------------------- |
| `string`        | `VARCHAR(n)` or `TEXT`             | Use `VARCHAR(n)` with `max_length`, otherwise `TEXT`  |
| `text`          | `TEXT`                             | For unlimited-length text                             |
| `integer`       | `INTEGER` or `INT`                 | 32-bit signed integer                                 |
| `bigint`        | `BIGINT`                           | 64-bit signed integer                                 |
| `float`         | `REAL` or `DOUBLE PRECISION`       | Single vs double precision                            |
| `decimal`       | `DECIMAL(p, s)` or `NUMERIC(p, s)` | Specify precision (p) and scale (s)                   |
| `boolean`       | `BOOLEAN`                          |                                                       |
| `datetime`      | `TIMESTAMP` or `TIMESTAMPTZ`       | Use `TIMESTAMPTZ` for timezone-aware                  |
| `date`          | `DATE`                             | Date only (no time)                                   |
| `time`          | `TIME` or `TIMETZ`                 | Time only (no date)                                   |
| `uuid`          | `UUID`                             | Requires `uuid-ossp` extension or `gen_random_uuid()` |
| `json`          | `JSONB` or `JSON`                  | Prefer `JSONB` for better performance                 |
| `enum`          | `ENUM`                             | Custom enum type                                      |
| `array`         | `TYPE[]`                           | Array of specified type                               |
| `bytes`         | `BYTEA`                            | Binary data                                           |

## Column Constraints

### NOT NULL

- **`required: true`** (or field not marked optional) → Add `NOT NULL` constraint
- **`required: false`** (or omitted) → Column is nullable (no `NOT NULL`)

### UNIQUE

- **`unique: true`** → Add `UNIQUE` constraint (can be inline or table-level)

### DEFAULT

- **`default: value`** → Add `DEFAULT value` clause
- Special defaults: `DEFAULT CURRENT_TIMESTAMP`, `DEFAULT gen_random_uuid()`, etc.

### PRIMARY KEY

- Typically an `id` field with `uuid` or `integer` type gets `PRIMARY KEY` constraint

## Special Cases

### String with Max Length

```sql
-- OpenIntent: { name: "email", type: "string", max_length: 255, required: true }
email VARCHAR(255) NOT NULL

-- OpenIntent: { name: "description", type: "text" }
description TEXT
```

### UUID Fields

```sql
-- First, enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- OpenIntent: { name: "id", type: "uuid", required: true }
id UUID PRIMARY KEY DEFAULT gen_random_uuid()

-- OpenIntent: { name: "user_id", type: "uuid", required: true }
user_id UUID NOT NULL
```

**Note**: PostgreSQL 13+ has `gen_random_uuid()` built-in. For older versions, use `uuid_generate_v4()` from `uuid-ossp`.

### Enum Types

```sql
-- Step 1: Create enum type
-- OpenIntent: { name: "status", type: "enum", enum_values: ["pending", "processing", "completed", "cancelled"] }
CREATE TYPE order_status AS ENUM ('pending', 'processing', 'completed', 'cancelled');

-- Step 2: Use in table
-- OpenIntent: { name: "status", type: "enum", enum_values: [...], required: true }
status order_status NOT NULL
```

**Note**: Enum values in PostgreSQL are case-sensitive. Use the exact values from `enum_values`.

### Array Types

```sql
-- OpenIntent: { name: "tags", type: "array", array_type: "string" }
tags TEXT[]

-- OpenIntent: { name: "user_ids", type: "array", array_type: "uuid" }
user_ids UUID[]

-- OpenIntent: { name: "scores", type: "array", array_type: "integer" }
scores INTEGER[]

-- OpenIntent: { name: "prices", type: "array", array_type: "decimal" }
prices DECIMAL(10, 2)[]
```

### Date/Time Types

```sql
-- OpenIntent: { name: "created_at", type: "datetime", required: true }
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP

-- OpenIntent: { name: "birthday", type: "date" }
birthday DATE

-- OpenIntent: { name: "opening_time", type: "time" }
opening_time TIME

-- OpenIntent: { name: "updated_at", type: "datetime", required: true }
-- For auto-updating timestamp, use trigger or application logic
updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP

-- For timezone-aware timestamps
created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

### JSON Fields

```sql
-- OpenIntent: { name: "metadata", type: "json" }
metadata JSONB

-- OpenIntent: { name: "preferences", type: "json", required: true }
preferences JSONB NOT NULL
```

**Note**: `JSONB` is preferred over `JSON` for better performance and indexing support.

### Decimal with Precision

```sql
-- OpenIntent: { name: "price", type: "decimal", required: true }
-- Default precision/scale if not specified
price DECIMAL(10, 2) NOT NULL

-- If precision/scale specified in OpenIntent (future enhancement)
-- price DECIMAL(10, 2) NOT NULL
```

### Bytes/Binary Data

```sql
-- OpenIntent: { name: "avatar", type: "bytes" }
avatar BYTEA
```

### Float Types

```sql
-- OpenIntent: { name: "rating", type: "float" }
-- Single precision (4 bytes)
rating REAL

-- Double precision (8 bytes) - more common
rating DOUBLE PRECISION
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

### Generated PostgreSQL DDL:

```sql
-- Create enum type first
CREATE TYPE user_status AS ENUM ('pending', 'active', 'suspended');

-- Create table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  bio TEXT,
  age INTEGER,
  balance DECIMAL(10, 2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tags TEXT[],
  status user_status NOT NULL,
  metadata JSONB
);

-- Create indexes (if needed)
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
```

## Table-Level Constraints

### Unique Constraints (Multiple Columns)

```sql
-- If unique constraint spans multiple columns
CONSTRAINT unique_user_email UNIQUE (user_id, email)
```

### Foreign Key Constraints

```sql
-- OpenIntent relation hint: customer_id references Customer.id
customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE
```

### Check Constraints

```sql
-- Example: ensure age is positive
age INTEGER CHECK (age >= 0)
```

## Indexes

Common indexes to create:

```sql
-- Primary key (automatic)
-- PRIMARY KEY (id)

-- Unique index (from unique: true)
CREATE UNIQUE INDEX idx_users_email ON users(email);

-- Foreign key index (for performance)
CREATE INDEX idx_orders_customer_id ON orders(customer_id);

-- Composite index
CREATE INDEX idx_users_status_created ON users(status, created_at);

-- GIN index for JSONB (for JSON queries)
CREATE INDEX idx_users_metadata ON users USING GIN (metadata);

-- GIN index for arrays (for array operations)
CREATE INDEX idx_users_tags ON users USING GIN (tags);
```

## Migration Patterns

### Creating a New Table

```sql
CREATE TABLE table_name (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- fields here
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Adding a Column

```sql
-- OpenIntent: add_field to existing entity
ALTER TABLE table_name
ADD COLUMN column_name TYPE [NOT NULL] [DEFAULT value] [UNIQUE];
```

### Creating Enum Type

```sql
CREATE TYPE enum_name AS ENUM ('value1', 'value2', 'value3');
```

### Dropping Enum Type

```sql
-- Note: Can only drop if no tables are using it
DROP TYPE enum_name;
```

## Generation Rules Summary

1. **Table names**: Convert entity name to snake_case plural (e.g., `Customer` → `customers`)
2. **Column names**: Convert field name to snake_case (e.g., `firstName` → `first_name`)
3. **Primary Key**: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` (for uuid type)
4. **Timestamps**: Common pattern `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
5. **Nullable columns**: Omit `NOT NULL` when `required` is false or omitted
6. **Enum types**: Must be created before table using `CREATE TYPE`
7. **Array syntax**: Use `TYPE[]` where TYPE is the PostgreSQL type
8. **Unique constraints**: Can be inline (`UNIQUE`) or table-level (`CONSTRAINT name UNIQUE (col)`)
9. **Foreign keys**: Use `REFERENCES table(column) [ON DELETE action]`
10. **Indexes**: Create indexes for foreign keys, unique fields, and frequently queried columns

## Edge Cases & Notes

- **VARCHAR vs TEXT**: Use `VARCHAR(n)` with `max_length`, otherwise `TEXT` for unlimited length
- **UUID extension**: May need `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` for older PostgreSQL versions
- **Enum ordering**: Enum values maintain the order they're defined (used in comparisons)
- **Array dimensions**: Can specify multi-dimensional arrays (e.g., `INTEGER[][]`)
- **JSON vs JSONB**: Prefer `JSONB` for better performance, indexing, and querying
- **Time zones**: Use `TIMESTAMPTZ` instead of `TIMESTAMP` for timezone-aware datetimes
- **Default values**: Must match column type (strings need quotes, numbers don't)
- **Composite types**: PostgreSQL supports custom composite types (not directly mapped from OpenIntent)
- **Sequences**: Can use `SERIAL` or `BIGSERIAL` for auto-incrementing integers (alternative to UUID)

## PostgreSQL-Specific Features

### Full-Text Search

```sql
-- Add tsvector column for full-text search
ALTER TABLE posts ADD COLUMN search_vector tsvector;

-- Create GIN index
CREATE INDEX idx_posts_search ON posts USING GIN(search_vector);

-- Update trigger (example)
CREATE TRIGGER update_search_vector BEFORE INSERT OR UPDATE ON posts
FOR EACH ROW EXECUTE FUNCTION tsvector_update_trigger(
  search_vector, 'pg_catalog.english', title, content
);
```

### Array Operators

```sql
-- Check if array contains value
SELECT * FROM users WHERE 'tag1' = ANY(tags);

-- Check if arrays overlap
SELECT * FROM users WHERE tags && ARRAY['tag1', 'tag2'];

-- Array length
SELECT * FROM users WHERE array_length(tags, 1) > 0;
```

### JSONB Operators

```sql
-- Query JSONB
SELECT * FROM users WHERE metadata->>'key' = 'value';

-- Check if JSONB contains key
SELECT * FROM users WHERE metadata ? 'key';

-- JSONB path queries
SELECT * FROM users WHERE metadata @> '{"status": "active"}';
```
