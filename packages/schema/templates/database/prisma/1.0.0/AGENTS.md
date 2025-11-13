This guide provides complete implementation instructions for applying OpenIntent data intents when using Prisma as the database framework.

## When to Use This Guide

Use this guide when `database.framework` in `project.yaml` is set to `"prisma"`.

## Prerequisites

- Prisma is installed and configured in the project
- `prisma/schema.prisma` file exists
- Database connection is configured in `.env`

## Field Type Mappings

### OpenIntent Type → Prisma Type

| OpenIntent Type | Prisma Type | Prisma Modifier    | Notes                                   |
| --------------- | ----------- | ------------------ | --------------------------------------- |
| `string`        | `String`    | `@db.VarChar(255)` | Use `max_length` attribute if specified |
| `text`          | `String`    | `@db.Text`         | For long text content                   |
| `integer`       | `Int`       | -                  | 32-bit integer                          |
| `bigint`        | `BigInt`    | -                  | 64-bit integer                          |
| `float`         | `Float`     | -                  | Floating point number                   |
| `decimal`       | `Decimal`   | -                  | Precise decimal number                  |
| `boolean`       | `Boolean`   | -                  | True/false value                        |
| `datetime`      | `DateTime`  | -                  | Date and time                           |
| `date`          | `DateTime`  | `@db.Date`         | Date only                               |
| `time`          | `DateTime`  | `@db.Time`         | Time only                               |
| `uuid`          | `String`    | `@db.Uuid`         | UUID string                             |
| `json`          | `Json`      | -                  | JSON data                               |
| `enum`          | `EnumName`  | -                  | Requires enum definition                |
| `array`         | `Type[]`    | -                  | Array of specified type                 |
| `bytes`         | `Bytes`     | -                  | Binary data                             |

### Field Attributes

| OpenIntent Attribute | Prisma Implementation                |
| -------------------- | ------------------------------------ |
| `required: true`     | No `?` after type (e.g., `String`)   |
| `required: false`    | Add `?` after type (e.g., `String?`) |
| `unique: true`       | Add `@unique` attribute              |
| `default: value`     | Add `@default(value)` attribute      |
| `max_length: N`      | Use `@db.VarChar(N)` for strings     |

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

   **CRITICAL:** Always run migrations immediately after schema changes. Prisma migrations apply database-level constraints (UNIQUE, NOT NULL, etc.) that are essential for data integrity.

6. **Regenerate Prisma client**:

   ```bash
   npx prisma generate
   ```

   **IMPORTANT:** After regenerating the Prisma client, you **must** update any existing API endpoints that create or update this entity to handle the new fields:
   - **For required fields**: Add them to request body validation with appropriate error messages
   - **For optional fields**: Add them as optional properties in request body types
   - Update TypeScript interfaces in `packages/types/index.ts` to include new fields
   - Ensure POST/PATCH handlers accept and process the new fields correctly

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

**After adding fields, update API endpoints:**

If you have a POST endpoint for creating customers (e.g., `app/api/customers/route.ts`), update it to accept the new optional fields:

```typescript
export async function POST(request: Request) {
  try {
    const body: Partial<CustomerInterface> = await request.json();

    // Existing validation
    if (!body.email || !body.name) {
      return NextResponse.json({ success: false, error: "Missing required fields: email, name" }, { status: 400 });
    }

    const customer = await prisma.customer.create({
      data: {
        email: body.email,
        name: body.name,
        phone: body.phone || null, // New optional field
        birthday: body.birthday || null, // New optional field
        status: body.status || "ACTIVE"
      }
    });

    return NextResponse.json({ data: customer }, { status: 201 });
  } catch (error) {
    // ... error handling
  }
}
```

**Update TypeScript types** in `packages/types/index.ts`:

```typescript
export interface CustomerInterface {
  id: string;
  email: string;
  name: string;
  phone: string | null; // New field - Prisma returns null, not undefined
  birthday: Date | null; // New field - Prisma returns null, not undefined
  status: "ACTIVE" | "INACTIVE" | "PENDING";
  created_at: Date;
}
```

## Implementing `add_relation` Intent

### Relation Types

| OpenIntent Relation | Prisma Implementation                                          |
| ------------------- | -------------------------------------------------------------- |
| `one_to_one`        | Foreign key field + `@unique`, relation field with `@relation` |
| `one_to_many`       | Reverse: array field on target entity                          |
| `many_to_one`       | Foreign key field, relation field with `@relation`             |
| `many_to_many`      | Array fields on both sides, Prisma creates join table          |

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

## Implementing `remove_entity` Intent

### Steps

1. **Verify the entity exists** in the Prisma schema

2. **Check for dependencies**:
   - Search for relations referencing this entity
   - If `cascade: true` is specified, related entities will be handled automatically
   - If `cascade: false`, ensure no foreign keys reference this entity

3. **Remove the model** from `prisma/schema.prisma`:
   - Delete the entire model definition
   - Remove any enum definitions used exclusively by this entity

4. **Remove relations** in other entities:
   - If other entities have relations to this entity, remove those relation fields
   - Update migration to drop foreign key constraints first

5. **Create and apply migration**:

   ```bash
   npx prisma migrate dev --name remove_{entity_lower}_entity
   ```

6. **If migration fails** due to foreign key constraints:
   - Manually create migration with proper order:
     ```sql
     -- First drop foreign key constraints
     ALTER TABLE "related_table" DROP CONSTRAINT "fk_constraint_name";
     -- Then drop the table
     DROP TABLE "{entity_name}s";
     ```

7. **Regenerate Prisma client**:
   ```bash
   npx prisma generate
   ```

### Example: Removing a Profile Entity

**Intent:**

```yaml
- kind: remove_entity
  scope: data
  entity: Profile
  cascade: false
```

**Before:**

```prisma
model User {
  id      String   @id @default(uuid()) @db.Uuid
  email   String   @unique
  profile Profile?

  @@map("users")
}

model Profile {
  id      String @id @default(uuid()) @db.Uuid
  bio     String @db.Text
  user_id String @unique @db.Uuid
  user    User   @relation(fields: [user_id], references: [id])

  @@map("profiles")
}
```

**After (both model and relation removed):**

```prisma
model User {
  id    String @id @default(uuid()) @db.Uuid
  email String @unique

  @@map("users")
}
```

## Implementing `rename_entity` Intent

### Steps

1. **Verify the entity exists** in the Prisma schema

2. **Rename the model** in `prisma/schema.prisma`:
   - Change the model name from old to new (PascalCase)
   - Update the `@@map()` directive to use the new table name (plural, lowercase)

3. **Update all references** to this entity:
   - Update relation fields in other models
   - Update enum names if they include the entity name
   - Update TypeScript types and interfaces

4. **Create and apply migration**:

   ```bash
   npx prisma migrate dev --name rename_{old_entity}_to_{new_entity}
   ```

   The migration will include:

   ```sql
   ALTER TABLE "{old_entity_name}s" RENAME TO "{new_entity_name}s";
   ```

5. **Regenerate Prisma client**:

   ```bash
   npx prisma generate
   ```

6. **Update application code**:
   - Update all database queries using the old entity name
   - Update API routes and handlers
   - Update TypeScript types

### Example: Renaming Customer to Client

**Intent:**

```yaml
- kind: rename_entity
  scope: data
  from: Customer
  to: Client
```

**Before:**

```prisma
model Customer {
  id         String   @id @default(uuid()) @db.Uuid
  email      String   @unique @db.VarChar(255)
  name       String   @db.VarChar(100)
  created_at DateTime @default(now())

  @@map("customers")
}
```

**After:**

```prisma
model Client {
  id         String   @id @default(uuid()) @db.Uuid
  email      String   @unique @db.VarChar(255)
  name       String   @db.VarChar(100)
  created_at DateTime @default(now())

  @@map("clients")
}
```

**Generated Migration:**

```sql
-- Rename table
ALTER TABLE "customers" RENAME TO "clients";
```

## Implementing `rename_field` Intent

### Steps

1. **Verify the entity and field exist** in the schema

2. **Rename the field** in the Prisma model:
   - Change the field name
   - If the field has a `@map()` directive, update the database column name as well
   - Maintain all attributes (type, required, unique, default, etc.)

3. **Update relation references** if the field is part of a relation:
   - Update `@relation` attributes that reference this field
   - Update foreign key field references

4. **Create and apply migration**:

   ```bash
   npx prisma migrate dev --name rename_{entity_lower}_{old_field}_to_{new_field}
   ```

   The migration will include:

   ```sql
   ALTER TABLE "{entity_name}s" RENAME COLUMN "{old_field}" TO "{new_field}";
   ```

5. **Regenerate Prisma client**:

   ```bash
   npx prisma generate
   ```

6. **Update application code**:
   - Update all queries and mutations using the old field name
   - Update TypeScript types and interfaces
   - Update API response fields if exposed

### Example: Renaming 'name' to 'full_name'

**Intent:**

```yaml
- kind: rename_field
  scope: data
  entity: Customer
  from: name
  to: full_name
```

**Before:**

```prisma
model Customer {
  id         String   @id @default(uuid()) @db.Uuid
  email      String   @unique @db.VarChar(255)
  name       String   @db.VarChar(100)
  created_at DateTime @default(now())

  @@map("customers")
}
```

**After:**

```prisma
model Customer {
  id         String   @id @default(uuid()) @db.Uuid
  email      String   @unique @db.VarChar(255)
  full_name  String   @db.VarChar(100)
  created_at DateTime @default(now())

  @@map("customers")
}
```

**Generated Migration:**

```sql
-- Rename column
ALTER TABLE "customers" RENAME COLUMN "name" TO "full_name";
```

### Example: Renaming a Foreign Key Field

**Intent:**

```yaml
- kind: rename_field
  scope: data
  entity: Todo
  from: user_id
  to: owner_id
```

**Before:**

```prisma
model Todo {
  id          String   @id @default(uuid()) @db.Uuid
  description String   @db.Text
  user_id     String   @db.Uuid
  user        User     @relation(fields: [user_id], references: [id])

  @@map("todos")
}

model User {
  id    String @id @default(uuid()) @db.Uuid
  email String @unique
  todos Todo[]

  @@map("users")
}
```

**After:**

```prisma
model Todo {
  id          String   @id @default(uuid()) @db.Uuid
  description String   @db.Text
  owner_id    String   @db.Uuid
  owner       User     @relation(fields: [owner_id], references: [id])

  @@map("todos")
}

model User {
  id    String @id @default(uuid()) @db.Uuid
  email String @unique
  todos Todo[]

  @@map("users")
}
```

**Generated Migration:**

```sql
-- Rename foreign key column
ALTER TABLE "todos" RENAME COLUMN "user_id" TO "owner_id";
```

## Migration Handling

### Standard Migration

```bash
npx prisma migrate dev --name {migration_name}
```

**CRITICAL STEPS:**

1. **Create migration**: `npx prisma migrate dev --name {migration_name}`
2. **Review migration SQL** in `prisma/migrations/{timestamp}_{migration_name}/migration.sql`
3. **Verify migration applied**: Check database schema matches Prisma schema
4. **Regenerate Prisma client**: `npx prisma generate` (required after every migration)
5. **Update TypeScript types**: Update `packages/types/index.ts` with new field types
6. **Update API endpoints**: Ensure POST/PATCH handlers accept new fields

### Database Drift

If you encounter "Database drift detected" errors:

```bash
npx prisma migrate dev --create-only --name {migration_name}
```

This creates the migration file without applying it. Review the migration, then apply manually if needed.

**Common causes of drift:**

- Manual database changes outside Prisma
- Conflicting migrations
- Schema changes made directly in database

**Resolution:**

1. Review the drift report carefully
2. Use `--create-only` to generate migration without applying
3. Manually edit migration SQL if needed
4. Apply migration: `npx prisma migrate deploy` (production) or `npx prisma migrate dev` (development)

### Migration Naming Conventions

- Add entity: `add_{entity_lower}_entity`
- Add field(s): `add_{entity_lower}_{field_name(s)}`
- Remove field(s): `remove_{entity_lower}_{field_name(s)}`
- Remove entity: `remove_{entity_lower}_entity`
- Rename entity: `rename_{old_entity}_to_{new_entity}`
- Rename field: `rename_{entity_lower}_{old_field}_to_{new_field}`
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
2. **Create migrations immediately** after schema changes - **CRITICAL** for applying database constraints
3. **Always regenerate Prisma client** after migrations: `npx prisma generate`
4. **Update API endpoints** when adding fields to entities - ensure POST/PATCH handlers accept new fields
5. **Update TypeScript types** in `packages/types/index.ts` after schema changes
6. **Use appropriate Prisma types** for database optimization
7. **Add indexes** for foreign keys (Prisma does this automatically)
8. **Review generated migrations** before applying to production
9. **Backup database** before running migrations
10. **Test migrations** in development environment first
11. **Keep enum names PascalCase** and values UPPER_SNAKE_CASE
12. **Verify migrations applied correctly** - check database schema matches Prisma schema
13. **Handle nullable fields correctly** - Prisma returns `null`, not `undefined` for optional fields

## TypeScript Type Generation

**CRITICAL:** After applying Prisma changes, you **must** update TypeScript types in `packages/types/index.ts`. This ensures type safety across your application.

**IMPORTANT:** Prisma returns `null` for nullable fields, not `undefined`. Always use `| null` for nullable fields, NOT optional `?` syntax.

**Steps:**

1. **Read the Prisma schema** to identify all fields and their types
2. **Map Prisma types to TypeScript types** using the mapping table below
3. **Update entity interfaces** in `packages/types/index.ts`
4. **Update response types** if needed
5. **Verify types compile** - run TypeScript compiler to check for errors

```typescript
// Map Prisma types to TypeScript types
export interface CustomerInterface {
  id: string; // String → string
  email: string; // String → string
  name: string; // String → string
  phone: string | null; // String? → string | null (NOT phone?: string)
  birthday: Date | null; // DateTime? → Date | null (NOT birthday?: Date)
  status: "ACTIVE" | "INACTIVE" | "PENDING"; // Enum → union type
  created_at: Date; // DateTime → Date
}

export interface CustomerResponse {
  data: CustomerInterface[];
}
```

**Type Mapping for Nullable Fields:**
| Prisma Type | TypeScript Type | ❌ WRONG |
|-------------|-----------------|----------|
| `String?` | `string \| null` | `string \| undefined` or `string?` |
| `Int?` | `number \| null` | `number \| undefined` or `number?` |
| `Boolean?` | `boolean \| null` | `boolean \| undefined` or `boolean?` |
| `DateTime?` | `Date \| null` | `Date \| undefined` or `Date?` |
| `Json?` | `any \| null` | `any \| undefined` or `any?` |

**Why `| null` instead of `?`:**

- Prisma client returns `null` for NULL database values
- TypeScript optional (`?`) resolves to `type | undefined`
- Mismatch causes type errors: `Type 'null' is not assignable to 'undefined'`

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
  orderBy: { created_at: "desc" }
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
