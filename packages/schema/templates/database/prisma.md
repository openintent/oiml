# Prisma Database Implementation Guide

This guide provides complete implementation instructions for applying OpenIntent data intents when using Prisma as the database framework.

## When to Use This Guide

Use this guide when `database.framework` in `project.yaml` is set to `"prisma"`.

## Prerequisites

- Prisma is installed and configured in the project
- `prisma/schema.prisma` file exists
- Database connection is configured in `.env`

## Field Type Mappings

### OpenIntent Type → Prisma Type

| OpenIntent Type | Prisma Type | Prisma Modifier | Notes |
|----------------|-------------|-----------------|-------|
| `string` | `String` | `@db.VarChar(255)` | Use `max_length` attribute if specified |
| `text` | `String` | `@db.Text` | For long text content |
| `integer` | `Int` | - | 32-bit integer |
| `bigint` | `BigInt` | - | 64-bit integer |
| `float` | `Float` | - | Floating point number |
| `decimal` | `Decimal` | - | Precise decimal number |
| `boolean` | `Boolean` | - | True/false value |
| `datetime` | `DateTime` | - | Date and time |
| `date` | `DateTime` | `@db.Date` | Date only |
| `time` | `DateTime` | `@db.Time` | Time only |
| `uuid` | `String` | `@db.Uuid` | UUID string |
| `json` | `Json` | - | JSON data |
| `enum` | `EnumName` | - | Requires enum definition |
| `array` | `Type[]` | - | Array of specified type |
| `bytes` | `Bytes` | - | Binary data |

### Field Attributes

| OpenIntent Attribute | Prisma Implementation |
|---------------------|----------------------|
| `required: true` | No `?` after type (e.g., `String`) |
| `required: false` | Add `?` after type (e.g., `String?`) |
| `unique: true` | Add `@unique` attribute |
| `default: value` | Add `@default(value)` attribute |
| `max_length: N` | Use `@db.VarChar(N)` for strings |

### Special Default Values

- `default: "uuid"` → `@default(uuid())`
- `default: "cuid"` → `@default(cuid())`
- `default: "now"` → `@default(now())`
- `default: "autoincrement"` → `@default(autoincrement())`

## Implementing `add_entity` Intent

### Steps

1. **Read the intent** and extract:
   - Entity name (PascalCase)
   - Array of fields with their types and attributes

2. **Generate Prisma model**:
   ```prisma
   model {EntityName} {
     field1  Type1  @id @default(uuid()) @db.Uuid
     field2  Type2  @unique @db.VarChar(255)
     field3  Type3
     
     @@map("{entity_name_plural}")
   }
   ```

3. **Add enum definitions** (if needed) BEFORE the model:
   ```prisma
   enum Status {
     ACTIVE
     INACTIVE
     PENDING
   }
   ```

4. **Always add `@@map()` directive** to map model name to table name:
   - Convention: `{EntityName}` → `@@map("{entity_name}s")`
   - Example: `User` → `@@map("users")`, `Customer` → `@@map("customers")`

5. **Create and apply migration**:
   ```bash
   npx prisma migrate dev --name add_{entity_lower}_entity
   ```

6. **Regenerate Prisma client**:
   ```bash
   npx prisma generate
   ```

### Example: Adding a Customer Entity

**Intent:**
```yaml
- kind: add_entity
  scope: data
  entity: Customer
  fields:
    - name: id
      type: uuid
      required: true
    - name: email
      type: string
      max_length: 255
      required: true
      unique: true
    - name: name
      type: string
      max_length: 100
      required: true
    - name: status
      type: enum
      enum_values: [ACTIVE, INACTIVE, PENDING]
      required: true
      default: ACTIVE
    - name: created_at
      type: datetime
      required: true
      default: now
```

**Generated Prisma Schema:**
```prisma
enum CustomerStatus {
  ACTIVE
  INACTIVE
  PENDING
}

model Customer {
  id         String         @id @default(uuid()) @db.Uuid
  email      String         @unique @db.VarChar(255)
  name       String         @db.VarChar(100)
  status     CustomerStatus @default(ACTIVE)
  created_at DateTime       @default(now())

  @@map("customers")
}
```

## Implementing `add_field` Intent

### Steps

1. **Verify the entity exists** in the Prisma schema

2. **Locate the model** in `prisma/schema.prisma`

3. **Add new fields** following the field type mappings above

4. **Add enum definitions** (if needed) before the model if they don't exist

5. **Create and apply migration**:
   ```bash
   npx prisma migrate dev --name add_{entity_lower}_{field_names}
   ```
   - For single field: `add_customer_phone`
   - For multiple fields: `add_customer_phone_address`

6. **Regenerate Prisma client**:
   ```bash
   npx prisma generate
   ```

### Example: Adding Fields to Customer

**Intent:**
```yaml
- kind: add_field
  scope: data
  entity: Customer
  fields:
    - name: phone
      type: string
      max_length: 20
      required: false
    - name: birthday
      type: date
      required: false
```

**Updated Prisma Model:**
```prisma
model Customer {
  id         String         @id @default(uuid()) @db.Uuid
  email      String         @unique @db.VarChar(255)
  name       String         @db.VarChar(100)
  phone      String?        @db.VarChar(20)      // New field
  birthday   DateTime?      @db.Date             // New field
  status     CustomerStatus @default(ACTIVE)
  created_at DateTime       @default(now())

  @@map("customers")
}
```

## Implementing `add_relation` Intent

### Relation Types

| OpenIntent Relation | Prisma Implementation |
|--------------------|----------------------|
| `one_to_one` | Foreign key field + `@unique`, relation field with `@relation` |
| `one_to_many` | Reverse: array field on target entity |
| `many_to_one` | Foreign key field, relation field with `@relation` |
| `many_to_many` | Array fields on both sides, Prisma creates join table |

### Steps for `many_to_one` Relation

1. **Verify both entities exist** in the schema

2. **Add foreign key field** to source entity:
   ```prisma
   {field_name}  String  @db.Uuid
   ```

3. **Add relation field** to source entity:
   ```prisma
   {relation_name}  {TargetEntity}  @relation(fields: [{field_name}], references: [id])
   ```

4. **Add reverse relation** to target entity (if specified):
   ```prisma
   {reverse_field_name}  {SourceEntity}[]
   ```

5. **Create and apply migration**:
   ```bash
   npx prisma migrate dev --name add_{source_entity}_{target_entity}_relation
   ```

6. **Regenerate Prisma client**:
   ```bash
   npx prisma generate
   ```

### Example: Todo → User Relation

**Intent:**
```yaml
- kind: add_relation
  scope: schema
  relation:
    source_entity: Todo
    target_entity: User
    kind: many_to_one
    field_name: user_id
    foreign_key:
      local_field: user_id
      target_field: id
    reverse:
      kind: one_to_many
      field_name: todos
```

**Updated Prisma Schema:**
```prisma
model Todo {
  id          String   @id @default(uuid()) @db.Uuid
  description String   @db.Text
  user_id     String   @db.Uuid                    // Foreign key field
  user        User     @relation(fields: [user_id], references: [id])  // Relation field
  
  @@map("todos")
}

model User {
  id    String @id @default(uuid()) @db.Uuid
  email String @unique
  todos Todo[]  // Reverse relation
  
  @@map("users")
}
```

## Implementing `remove_field` Intent

### Steps

1. **Verify the entity and fields exist** in the schema

2. **Remove the fields** from the Prisma model

3. **Remove related enum definitions** if no longer used

4. **Create and apply migration**:
   ```bash
   npx prisma migrate dev --name remove_{entity_lower}_{field_names}
   ```

5. **If migration fails** due to database drift:
   - Manually create migration directory: `prisma/migrations/{timestamp}_remove_{entity_lower}_{field_names}/`
   - Create `migration.sql` with `ALTER TABLE` statements
   - Check for duplicate migrations

6. **Regenerate Prisma client**:
   ```bash
   npx prisma generate
   ```

## Migration Handling

### Standard Migration

```bash
npx prisma migrate dev --name {migration_name}
```

### Database Drift

If you encounter "Database drift detected" errors:

```bash
npx prisma migrate dev --create-only --name {migration_name}
```

This creates the migration file without applying it. Review the migration, then apply manually if needed.

### Migration Naming Conventions

- Add entity: `add_{entity_lower}_entity`
- Add field(s): `add_{entity_lower}_{field_name(s)}`
- Remove field(s): `remove_{entity_lower}_{field_name(s)}`
- Add relation: `add_{source_entity}_{target_entity}_relation`

## Common Patterns

### Auto-incrementing ID
```prisma
id  Int  @id @default(autoincrement())
```

### UUID Primary Key
```prisma
id  String  @id @default(uuid()) @db.Uuid
```

### CUID Primary Key
```prisma
id  String  @id @default(cuid())
```

### Timestamps
```prisma
created_at  DateTime  @default(now())
updated_at  DateTime  @updatedAt
```

### Optional Fields
```prisma
field_name  String?  @db.VarChar(255)
```

### Array Fields
```prisma
tags  String[]
```

### JSON Fields
```prisma
metadata  Json
```

## Error Handling

### Common Errors

**"Database drift detected"**
- Solution: Use `--create-only` flag and review migration manually

**"Model not found"**
- Solution: Verify entity name matches exactly (case-sensitive)

**"Field already exists"**
- Solution: Check if field was already added in a previous migration

**"Relation ambiguity"**
- Solution: Add relation name to `@relation("relationName")`

## Best Practices

1. **Always use `@@map()` directive** for consistent table naming
2. **Create migrations immediately** after schema changes
3. **Use appropriate Prisma types** for database optimization
4. **Add indexes** for foreign keys (Prisma does this automatically)
5. **Review generated migrations** before applying to production
6. **Backup database** before running migrations
7. **Test migrations** in development environment first
8. **Keep enum names PascalCase** and values UPPER_SNAKE_CASE

## TypeScript Type Generation

After applying Prisma changes, update TypeScript types in `packages/types/index.ts`:

```typescript
// Map Prisma types to TypeScript types
export interface CustomerInterface {
  id: string;              // String → string
  email: string;           // String → string
  name: string;            // String → string
  phone?: string;          // String? → string | undefined
  birthday?: Date;         // DateTime? → Date | undefined
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING';  // Enum → union type
  created_at: Date;        // DateTime → Date
}

export interface CustomerResponse {
  data: CustomerInterface[];
}
```

## Database Client Usage

Import and use the Prisma client:

```typescript
import { prisma } from "@/lib/prisma";

// Create
const customer = await prisma.customer.create({
  data: { email: "test@example.com", name: "Test User", status: "ACTIVE" }
});

// Read
const customers = await prisma.customer.findMany({
  where: { status: "ACTIVE" },
  orderBy: { created_at: 'desc' }
});

// Update
const updated = await prisma.customer.update({
  where: { id: "some-uuid" },
  data: { status: "INACTIVE" }
});

// Delete
await prisma.customer.delete({
  where: { id: "some-uuid" }
});
```

