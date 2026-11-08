This guide provides complete implementation instructions for applying OSL data intents when using Drizzle ORM as the database framework.

## When to Use This Guide

Use this guide when `database.framework` in `project.yaml` is set to `"drizzle"`.

## Supported Versions

| Package       | Supported range   | Verified with |
| ------------- | ----------------- | ------------- |
| `drizzle-orm` | `>=0.45.0 <1.0.0` | `0.45.4`      |
| `drizzle-kit` | `>=0.31.0 <1.0.0` | `0.31.11`     |
| OSL           | `>=0.1.0 <0.2.0`  | `0.1.0`       |

Drizzle 1.0 (published as `1.0.0-rc.*` / `1.0.0-beta.*`) replaces the relations API with `defineRelations` and changes the migrations folder layout. **This guide does not cover Drizzle 1.x.** If the installed `drizzle-orm` version starts with `1.`, stop and report that no compatible template exists.

When calling `resolve_template`, pass `framework: "drizzle"` and the **installed `drizzle-orm` version** (read it from `node_modules/drizzle-orm/package.json`, not from the range in `package.json`).

## Prerequisites

- `drizzle-orm` and `drizzle-kit` are installed
- A database driver is installed for the configured dialect (see [Project Setup](#project-setup))
- `drizzle.config.ts` exists at the project root
- `DATABASE_URL` is configured in `.env`

If any of these are missing, follow [Project Setup](#project-setup) before applying intents.

## Dialect Resolution

Read `database.type` from `project.yaml` and map it to a Drizzle dialect. Every code example in this guide depends on this choice.

| `database.type` | Drizzle dialect | Core module               | Table function | Driver package   |
| --------------- | --------------- | ------------------------- | -------------- | ---------------- |
| `postgres`      | `postgresql`    | `drizzle-orm/pg-core`     | `pgTable`      | `pg`             |
| `cockroachdb`   | `postgresql`    | `drizzle-orm/pg-core`     | `pgTable`      | `pg`             |
| `mysql`         | `mysql`         | `drizzle-orm/mysql-core`  | `mysqlTable`   | `mysql2`         |
| `mariadb`       | `mysql`         | `drizzle-orm/mysql-core`  | `mysqlTable`   | `mysql2`         |
| `sqlite`        | `sqlite`        | `drizzle-orm/sqlite-core` | `sqliteTable`  | `@libsql/client` |

Any other `database.type` is not supported by this guide. Stop and report the error.

Examples below use PostgreSQL unless a section says otherwise. MySQL and SQLite equivalents are listed in the [type mapping tables](#field-type-mappings).

## File Layout

| File                      | Purpose                                         | Source of the path                                        |
| ------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| `lib/schema.ts`           | All tables, enums and `relations()` definitions | `database.schema` in `project.yaml`, else `lib/schema.ts` |
| `lib/db.ts`               | Exports the `db` client                         | Fixed. API packs import `db` from `@/lib/db`              |
| `drizzle.config.ts`       | drizzle-kit configuration                       | Project root                                              |
| `drizzle/`                | Generated SQL migrations and snapshots          | `out` in `drizzle.config.ts`                              |
| `packages/types/index.ts` | Entity types derived from the schema            | `paths.types` in `project.yaml`, else `packages/types`    |

API framework guides (for example the Next.js guide) import tables with `import { {entity_plural} } from '@/lib/schema'` and the client with `import { db } from '@/lib/db'`.

- **New projects:** create the schema at `lib/schema.ts` and the client at `lib/db.ts` so those imports work unchanged.
- **Existing projects** whose `database.schema` points elsewhere (for example `src/db/schema.ts`): keep the existing layout. Wherever an API guide says `@/lib/schema`, import from the module at `database.schema` instead (for example `@/db/schema`). Look for an existing `drizzle(` call before creating `lib/db.ts`, and import `db` from there.

## Naming Conventions

Apply these rules deterministically. They are derived from the IR produced by `transform_to_ir`.

| Thing                    | Rule                                   | Example (`BlogPost`)                  |
| ------------------------ | -------------------------------------- | ------------------------------------- |
| SQL table name           | IR `entity.storage.tableName`          | `blog_posts`                          |
| Table export name        | camelCase of the SQL table name        | `blogPosts`                           |
| Column key and SQL name  | The OSL field name, unchanged          | `created_at`                          |
| Relations export name    | `{tableExport}Relations`               | `blogPostsRelations`                  |
| PostgreSQL enum SQL name | snake_case of the IR enum name         | `BlogPostStatus` → `blog_post_status` |
| PostgreSQL enum export   | camelCase of the IR enum name + `Enum` | `blogPostStatusEnum`                  |
| Junction table           | `{source_table}_to_{target_table}`     | `blog_posts_to_tags`                  |
| Junction export          | camelCase of the junction table        | `blogPostsToTags`                     |

**Column naming rule:** Drizzle uses the object key as the SQL column name when no name argument is given. Write columns as `created_at: timestamp()`, never `createdAt: timestamp("created_at")`. Do **not** set the `casing` option in `drizzle()` or `drizzle.config.ts`. This keeps TypeScript property names, SQL column names and OSL field names identical, which is what the API guides expect.

## Field Type Mappings

### OSL / IR Type → Drizzle Column

| OSL type   | IR type           | PostgreSQL (`pg-core`)              | MySQL (`mysql-core`)                    | SQLite (`sqlite-core`)                | TypeScript value |
| ---------- | ----------------- | ----------------------------------- | --------------------------------------- | ------------------------------------- | ---------------- |
| `string`   | `Scalar String`   | `varchar({ length: N })`            | `varchar({ length: N })`                | `text({ length: N })`                 | `string`         |
| `text`     | `Scalar Text`     | `text()`                            | `text()`                                | `text()`                              | `string`         |
| `integer`  | `Scalar Int`      | `integer()`                         | `int()`                                 | `integer()`                           | `number`         |
| `bigint`   | `Scalar BigInt`   | `bigint({ mode: "number" })`        | `bigint({ mode: "number" })`            | `integer({ mode: "number" })`         | `number`         |
| `float`    | `Scalar Float`    | `doublePrecision()`                 | `double()`                              | `real()`                              | `number`         |
| `decimal`  | `Scalar Decimal`  | `numeric()`                         | `decimal({ precision: 65, scale: 30 })` | `numeric()`                           | `string`         |
| `boolean`  | `Scalar Boolean`  | `boolean()`                         | `boolean()`                             | `integer({ mode: "boolean" })`        | `boolean`        |
| `datetime` | `Scalar DateTime` | `timestamp({ withTimezone: true })` | `datetime({ mode: "date", fsp: 3 })`    | `integer({ mode: "timestamp_ms" })`   | `Date`           |
| `date`     | `Scalar Date`     | `date()`                            | `date({ mode: "string" })`              | `text()`                              | `string`         |
| `time`     | `Scalar Time`     | `time()`                            | `time()`                                | `text()`                              | `string`         |
| `uuid`     | `Scalar UUID`     | `uuid()`                            | `varchar({ length: 36 })`               | `text()`                              | `string`         |
| `bytes`    | `Scalar Bytes`    | `bytea()` (custom type, see below)  | `longblob()` (custom type, see below)   | `blob({ mode: "buffer" })`            | `Uint8Array`     |
| `json`     | `Json`            | `jsonb()`                           | `json()`                                | `text({ mode: "json" })`              | `unknown`        |
| `enum`     | `Enum`            | `{enumExport}()` from `pgEnum`      | `mysqlEnum([...values])`                | `text({ enum: [...values] })`         | union of values  |
| `array`    | `Array`           | `{elementBuilder}().array()`        | `json().$type<T[]>()`                   | `text({ mode: "json" }).$type<T[]>()` | `T[]`            |

`N` for `string` is the IR `MaxLength` validation, or `255` when the intent has no `max_length`.

**Notes:**

- `decimal` values are returned as **strings** to avoid floating point loss. Pass strings when inserting (`balance: "10.50"`).
- `bigint` uses `mode: "number"` so values serialize with `JSON.stringify` in API responses. Values above `Number.MAX_SAFE_INTEGER` lose precision. If the intent's description or `ai_context` says values can exceed 2^53, use `mode: "bigint"` and convert to string before returning JSON.
- `date` and `time` are returned as ISO strings (`"2025-01-31"`, `"13:45:00"`), not `Date` objects.
- For `json`, add `.$type<T>()` when the shape is known from `ai_context` or field description. Otherwise leave it as `unknown`.
- MySQL and SQLite have no native arrays. Store arrays as JSON and add an `IR` diagnostic note to `plan.yaml` warnings: `"array field {name} stored as JSON on {dialect}"`.
- MySQL `enum` is column-level. There is no separate enum declaration.

### Custom Binary Types

Drizzle 0.45 has no built-in `bytea` (PostgreSQL) or `longblob` (MySQL) column. Declare a custom type **once** near the top of the schema file and reuse it:

```typescript
// PostgreSQL
import { customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea"
});
```

```typescript
// MySQL
import { customType } from "drizzle-orm/mysql-core";

const longblob = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "longblob"
});
```

Type the data as `Uint8Array`, not `Buffer`. Node's `pg` driver returns a `Buffer`, which is a `Uint8Array`, but other drivers (PGlite, serverless drivers) return a plain `Uint8Array`.

### Field Modifiers

| OSL attribute / IR property                                              | Drizzle implementation                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `required: true` / IR `nullable: false`                                  | `.notNull()`                                                                 |
| `required: false` or omitted / `nullable: true`                          | No modifier (columns are nullable by default)                                |
| `unique: true`                                                           | `.unique()`                                                                  |
| `default: <literal>` / IR `Literal`                                      | `.default(<literal>)`                                                        |
| `default: now` / IR `Now` (PostgreSQL)                                   | `.defaultNow()`                                                              |
| `default: now` / IR `Now` (MySQL)                                        | `.default(sql\`CURRENT_TIMESTAMP(3)\`)`                                      |
| `default: now` / IR `Now` (SQLite)                                       | `.$defaultFn(() => new Date())`                                              |
| `updated_at` attribute, or a field named `updated_at` of type `datetime` | Add the `Now` default **and** `.$onUpdate(() => new Date())`                 |
| IR `isPrimary`                                                           | `.primaryKey()`                                                              |
| Composite primary key (`primary_key` with 2+ fields)                     | `primaryKey({ columns: [t.a, t.b] })` in the table's extra config            |
| `indexes[]` entry                                                        | `index("{name}").on(...)` or `uniqueIndex("{name}").on(...)` in extra config |
| `unique` (multi-column, entity level)                                    | `uniqueIndex("{table}_{col1}_{col2}_unique").on(t.col1, t.col2)`             |

`$defaultFn` and `$onUpdate` run in the application, not in the database. They apply to inserts and updates made through Drizzle only.

### Primary Key Strategies

Use the IR `generated.strategy` on the primary key field:

| IR strategy     | PostgreSQL                                           | MySQL                                                                        | SQLite                                                      |
| --------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `UUID`          | `uuid().primaryKey().defaultRandom()`                | `varchar({ length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID())` | `text().primaryKey().$defaultFn(() => crypto.randomUUID())` |
| `AutoIncrement` | `integer().primaryKey().generatedAlwaysAsIdentity()` | `int().primaryKey().autoincrement()`                                         | `integer().primaryKey({ autoIncrement: true })`             |

On PostgreSQL, use identity columns (`generatedAlwaysAsIdentity`), not `serial`. Identity columns reject explicit ID values on insert, so never pass `id` when inserting into an `AutoIncrement` table.

### Special Default Values

- `default: "uuid"` on a `uuid` field → PostgreSQL `.defaultRandom()`; MySQL/SQLite `.$defaultFn(() => crypto.randomUUID())`
- `default: "now"` → see the `Now` rows in [Field Modifiers](#field-modifiers)
- `default: "autoincrement"` → see [Primary Key Strategies](#primary-key-strategies)
- `default: "cuid"` → not supported natively. Install `@paralleldrive/cuid2` and use `.$defaultFn(() => createId())`.

## Project Setup

Run this only when the project has no Drizzle setup yet (no `drizzle.config.ts` or no `lib/db.ts`). Record each created file in `plan.yaml` and `summary.yaml`.

### 1. Install Packages

```bash
# Always
npm install drizzle-orm@^0.45
npm install -D drizzle-kit@^0.31 dotenv

# PostgreSQL / CockroachDB
npm install pg
npm install -D @types/pg

# MySQL / MariaDB
npm install mysql2

# SQLite
npm install @libsql/client
```

Use the project's package manager (`pnpm add`, `yarn add`) if a lockfile for it exists.

### 2. Create `drizzle.config.ts`

```typescript
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql", // "mysql" or "sqlite" per Dialect Resolution
  schema: "./lib/schema.ts", // database.schema from project.yaml
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!
  }
});
```

For SQLite with a local file, `DATABASE_URL` is a libSQL URL such as `file:local.db`.

### 3. Create `lib/db.ts`

The client must receive the full schema module so relational queries (`db.query.{table}`) work.

**PostgreSQL:**

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Reuse the pool across hot reloads in development
const globalForDb = globalThis as unknown as { pool?: Pool };

const pool = globalForDb.pool ?? new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle({ client: pool, schema });
```

**MySQL:**

```typescript
import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type Pool } from "mysql2/promise";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pool?: Pool };

const pool = globalForDb.pool ?? createPool(process.env.DATABASE_URL!);

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

// mode is required for relational queries on mysql2
export const db = drizzle({ client: pool, schema, mode: "default" });
```

**SQLite:**

```typescript
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

export const db = drizzle({ client: createClient({ url: process.env.DATABASE_URL! }), schema });
```

### 4. Create `lib/schema.ts`

Start with only the imports that the first intent needs. Add imports as later intents need them. Unused imports fail linting in most projects.

### 5. Add Package Scripts

Add these scripts to `package.json` if they do not exist:

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:check": "drizzle-kit check"
  }
}
```

## Implementing `add_entity` Intent

### Steps

1. **Use the IR** from `transform_to_ir`. Read `entity.storage.tableName`, every field's resolved type, nullability, defaults, generated strategy and validations.

2. **Declare enums first** (PostgreSQL only). For each `Enum` field, add a `pgEnum` above the table if it does not already exist:

   ```typescript
   export const customerStatusEnum = pgEnum("customer_status", ["ACTIVE", "INACTIVE", "PENDING"]);
   ```

3. **Declare custom types** (`bytea`, `longblob`) once, if a `bytes` field is present and the custom type is not already declared.

4. **Add the table** to the schema file, following the naming conventions and type mappings:

   ```typescript
   export const {tableExport} = pgTable("{table_name}", {
     {field}: {builder}({options}){modifiers},
     ...
   });
   ```

   Add a third argument returning an array only when the entity needs composite primary keys, indexes or multi-column unique constraints:

   ```typescript
   export const {tableExport} = pgTable(
     "{table_name}",
     { ... },
     t => [index("{table_name}_{column}_idx").on(t.{column})]
   );
   ```

5. **Add foreign key columns** for any field with a `Reference` type. Follow [`add_relation`](#implementing-add_relation-intent).

6. **Generate the migration** (always). See [Migration Handling](#migration-handling):

   ```bash
   npx drizzle-kit generate --name add_{entity_lower}_entity
   ```

7. **Apply the migration** only when `database.autorun_migrations: true`:

   ```bash
   npx drizzle-kit migrate
   ```

8. **Update TypeScript types** in `packages/types/index.ts`. See [TypeScript Types](#typescript-types).

Drizzle has no separate client generation step. The schema module is the client's source of truth.

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

**Generated schema (`lib/schema.ts`, PostgreSQL):**

```typescript
import { pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const customerStatusEnum = pgEnum("customer_status", ["ACTIVE", "INACTIVE", "PENDING"]);

export const customers = pgTable("customers", {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).notNull().unique(),
  name: varchar({ length: 100 }).notNull(),
  status: customerStatusEnum().notNull().default("ACTIVE"),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow()
});
```

**Generated migration (`drizzle/0000_add_customer_entity.sql`):**

```sql
CREATE TYPE "public"."customer_status" AS ENUM('ACTIVE', 'INACTIVE', 'PENDING');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" "customer_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
```

**Same entity on MySQL:**

```typescript
import { sql } from "drizzle-orm";
import { datetime, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core";

export const customers = mysqlTable("customers", {
  id: varchar({ length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: varchar({ length: 255 }).notNull().unique(),
  name: varchar({ length: 100 }).notNull(),
  status: mysqlEnum(["ACTIVE", "INACTIVE", "PENDING"]).notNull().default("ACTIVE"),
  created_at: datetime({ mode: "date", fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
});
```

**Same entity on SQLite:**

```typescript
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const customers = sqliteTable("customers", {
  id: text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text({ length: 255 }).notNull().unique(),
  name: text({ length: 100 }).notNull(),
  status: text({ enum: ["ACTIVE", "INACTIVE", "PENDING"] })
    .notNull()
    .default("ACTIVE"),
  created_at: integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
});
```

## Implementing `add_field` Intent

### Steps

1. **Verify the table exists** in the schema file. Find it by its SQL table name (IR `tableName` of the entity), not by guessing the export name.

2. **Add the new columns** to the table object, following the type mappings and modifiers above.

3. **Declare new enums or custom types** if needed.

4. **Watch for required fields on existing tables.** Adding a `.notNull()` column without a default to a table that already has rows fails when the migration runs. When the field is `required: true` and has no `default`:
   - Add a warning to `plan.yaml`: `"Adding NOT NULL column {field} without default to existing table {table}"`
   - Keep the column `.notNull()` as the intent requires. Do not invent a default.

5. **Generate the migration** (always):

   ```bash
   npx drizzle-kit generate --name add_{entity_lower}_{field_names}
   ```

   - For a single field: `add_customer_phone`
   - For multiple fields: `add_customer_phone_birthday`

6. **Apply the migration** only when `database.autorun_migrations: true`:

   ```bash
   npx drizzle-kit migrate
   ```

7. **Update API endpoints** that create or update this entity:
   - **Required fields**: add them to request body validation with clear error messages
   - **Optional fields**: accept them as optional properties
   - Types derived with `$inferSelect` / `$inferInsert` update automatically. Check that handlers still compile.

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

**Updated table:**

```typescript
export const customers = pgTable("customers", {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).notNull().unique(),
  name: varchar({ length: 100 }).notNull(),
  phone: varchar({ length: 20 }), // New field
  birthday: date(), // New field
  status: customerStatusEnum().notNull().default("ACTIVE"),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow()
});
```

**Generated migration:**

```sql
ALTER TABLE "customers" ADD COLUMN "phone" varchar(20);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "birthday" date;
```

**Updated POST handler:**

```typescript
const [customer] = await db
  .insert(customers)
  .values({
    email: body.email,
    name: body.name,
    phone: body.phone ?? null, // New optional field
    birthday: body.birthday ?? null // New optional field, "YYYY-MM-DD"
  })
  .returning();
```

## Implementing `add_relation` Intent

Drizzle splits a relation into two parts. Generate **both**:

1. **Foreign key column** with `.references()`. This creates the database constraint and is what migrations see.
2. **`relations()` definitions**. These power relational queries (`db.query.users.findMany({ with: { posts: true } })`). They have no effect on the database or migrations.

### Relation Types

| OSL relation   | Foreign key                                             | `relations()` on source               | `relations()` on target               |
| -------------- | ------------------------------------------------------- | ------------------------------------- | ------------------------------------- |
| `many_to_one`  | FK column on source                                     | `one(target, { fields, references })` | `many(source)` (if `reverse` is set)  |
| `one_to_one`   | FK column on source with `.unique()`                    | `one(target, { fields, references })` | `one(source)` (if `reverse` is set)   |
| `one_to_many`  | FK column on **target** pointing to source              | `many(target)`                        | `one(source, { fields, references })` |
| `many_to_many` | Junction table with two FKs and a composite primary key | `many(junction)`                      | `many(junction)`                      |

### Name Resolution

Read these from the IR when it is available: `AddRelation` IR has them under `relation.type` (`foreignKey.localField`, `foreignKey.targetField`, `relationName`, `nullable`, `onDelete`, `reverse.fieldName`), and a field declared with `relation:` has them under the field's `reference`. `foreignKey.entity` names the table that gets the column. The table below gives the same values from the raw intent.

| Item                    | Value                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| FK column name          | `relation.foreign_key.local_field`                                                                                |
| Referenced column       | `relation.foreign_key.target_field` (usually `id`)                                                                |
| Relation name on source | `relation.field_name`. If it equals the FK column name, drop a trailing `_id`                                     |
| Relation name on target | `relation.reverse.field_name`                                                                                     |
| FK column type          | The type of the referenced column, without its default or generated strategy                                      |
| FK nullability          | `.notNull()` unless the relation attributes include `nullable` or `optional`                                      |
| `onDelete`              | IR `onDelete`: `Restrict` → `"restrict"`, `Cascade` → `"cascade"`, `SetNull` → `"set null"`. Default `"restrict"` |

When `onDelete` is `"set null"`, the FK column must be nullable. Omit `.notNull()` and add a note to `plan.yaml`.

### Steps for `many_to_one`

1. **Verify both tables exist** in the schema.

2. **Add the FK column** to the source table:

   ```typescript
   {fk_column}: uuid()
     .notNull()
     .references(() => {targetExport}.{target_field}, { onDelete: "restrict" }),
   ```

   If the target table is declared **below** the source table, this still works because `.references()` takes a callback.

3. **Add an index** on the FK column in the source table's extra config. PostgreSQL does not index foreign keys automatically:

   ```typescript
   t => [index("{source_table}_{fk_column}_idx").on(t.{fk_column})]
   ```

4. **Add or extend `relations()`** for both tables. Each table must have **exactly one** `relations()` export. If one exists, add the new key to it. Do not create a second `relations()` call for the same table.

5. **Generate the migration** (always):

   ```bash
   npx drizzle-kit generate --name add_{source_entity}_{target_entity}_relation
   ```

6. **Apply the migration** only when `database.autorun_migrations: true`.

### Example: Todo → User Relation

**Intent:**

```yaml
- kind: add_relation
  scope: data
  relation:
    source_entity: Todo
    target_entity: User
    kind: many_to_one
    field_name: user
    foreign_key:
      local_field: user_id
      target_field: id
    reverse:
      kind: one_to_many
      field_name: todos
```

**Updated schema:**

```typescript
import { relations } from "drizzle-orm";
import { index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).notNull().unique()
});

export const todos = pgTable(
  "todos",
  {
    id: uuid().primaryKey().defaultRandom(),
    description: text().notNull(),
    user_id: uuid() // Foreign key column
      .notNull()
      .references(() => users.id, { onDelete: "restrict" })
  },
  t => [index("todos_user_id_idx").on(t.user_id)]
);

export const usersRelations = relations(users, ({ many }) => ({
  todos: many(todos) // Reverse relation
}));

export const todosRelations = relations(todos, ({ one }) => ({
  user: one(users, { fields: [todos.user_id], references: [users.id] })
}));
```

**Generated migration:**

```sql
ALTER TABLE "todos" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todos_user_id_idx" ON "todos" USING btree ("user_id");
```

### Example: `many_to_many` (Post ↔ Tag)

Drizzle does not create junction tables implicitly. Create one explicitly:

```typescript
export const postsToTags = pgTable(
  "posts_to_tags",
  {
    post_id: uuid()
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tag_id: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" })
  },
  t => [primaryKey({ columns: [t.post_id, t.tag_id] })]
);

export const postsRelations = relations(posts, ({ many }) => ({
  postsToTags: many(postsToTags)
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  postsToTags: many(postsToTags)
}));

export const postsToTagsRelations = relations(postsToTags, ({ one }) => ({
  post: one(posts, { fields: [postsToTags.post_id], references: [posts.id] }),
  tag: one(tags, { fields: [postsToTags.tag_id], references: [tags.id] })
}));
```

Query through the junction:

```typescript
const post = await db.query.posts.findFirst({
  where: (posts, { eq }) => eq(posts.id, id),
  with: { postsToTags: { with: { tag: true } } }
});
const tagList = post?.postsToTags.map(pt => pt.tag) ?? [];
```

Junction FKs always use `onDelete: "cascade"`, so deleting either side removes the link rows.

## Implementing `remove_field` Intent

### Steps

1. **Verify the table and columns exist** in the schema.

2. **Remove the columns** from the table object.

3. **Clean up references to the removed columns**:
   - Indexes and unique constraints in the table's extra config
   - `relations()` entries whose `fields` use a removed FK column
   - Enums or custom types no longer used by any column

4. **Generate the migration** (always):

   ```bash
   npx drizzle-kit generate --name remove_{entity_lower}_{field_names}
   ```

   Removing columns only never triggers an interactive prompt. If drizzle-kit fails with `Interactive prompts require a TTY terminal`, the schema also contains an unapplied addition in the same table. See [Non-Interactive Generation](#non-interactive-generation).

5. **Apply the migration** only when `database.autorun_migrations: true`.

6. **Update application code** that reads or writes the removed fields. TypeScript reports every usage once the column is gone.

## Implementing `remove_entity` Intent

### Steps

1. **Verify the table exists** in the schema.

2. **Check for dependents**: search the schema for `.references(() => {tableExport}.` in other tables.
   - If `cascade: false` and dependents exist: **stop** and report which tables reference this entity. Do not drop the FK columns on your own.
   - If `cascade: true`: remove the FK columns that reference this table, their indexes and their `relations()` entries in the dependent tables.

3. **Remove from the schema**:
   - The table export
   - Its `relations()` export
   - Relation keys in other tables' `relations()` that point to it (`many(...)` / `one(...)`)
   - Enums and custom types used only by this table
   - Junction tables that exist only to link this table

4. **Generate the migration** (always):

   ```bash
   npx drizzle-kit generate --name remove_{entity_lower}_entity
   ```

   drizzle-kit orders the statements so foreign keys are dropped before the table.

5. **Apply the migration** only when `database.autorun_migrations: true`.

6. **Remove application code** for the entity: API routes, types in `packages/types/index.ts` and imports.

### Example: Removing a Profile Entity

**Intent:**

```yaml
- kind: remove_entity
  scope: data
  entity: Profile
  cascade: false
```

**Before:**

```typescript
export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).notNull().unique()
});

export const profiles = pgTable("profiles", {
  id: uuid().primaryKey().defaultRandom(),
  bio: text().notNull(),
  user_id: uuid()
    .notNull()
    .unique()
    .references(() => users.id)
});

export const usersRelations = relations(users, ({ one }) => ({
  profile: one(profiles)
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.user_id], references: [users.id] })
}));
```

`profiles` references `users`, but nothing references `profiles`, so `cascade: false` allows removal.

**After:**

```typescript
export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).notNull().unique()
});
```

`usersRelations` is removed because its only key pointed to `profiles`.

## Implementing `rename_entity` Intent

Renames need special handling. drizzle-kit cannot tell a rename from a drop plus a create, so it asks interactively. Agents run without a terminal, where that prompt fails with:

```
Error: Interactive prompts require a TTY terminal
```

Follow the [Rename Procedure](#rename-procedure) instead of running a plain `generate`.

### Steps

1. **Verify the entity exists** and the new name is not taken.

2. **Compute names** from the new entity name using the [naming conventions](#naming-conventions): new SQL table name (snake_case plural), new table export (camelCase), new relations export.

3. **Update the schema file**:
   - Rename the table export and its SQL name: `pgTable("{new_table}", ...)`
   - Rename its `relations()` export and update the first argument
   - Update every `.references(() => {oldExport}.x)` and every `one({oldExport}, ...)` / `many({oldExport})` in other tables
   - Rename PostgreSQL enums whose name includes the entity name, if the intent's `ai_context` asks for it. Otherwise keep enum names unchanged.

4. **Write the migration** with the [Rename Procedure](#rename-procedure) using migration name `rename_{old_entity}_to_{new_entity}` and this SQL:

   ```sql
   ALTER TABLE "{old_table}" RENAME TO "{new_table}";
   ```

   MySQL uses backticks: ``RENAME TABLE `{old_table}` TO `{new_table}`;``. SQLite: ``ALTER TABLE `{old_table}` RENAME TO `{new_table}`;``.

5. **Apply the migration** only when `database.autorun_migrations: true`.

6. **Update application code**: imports of the old export, `db.query.{oldExport}` calls, API routes and types.

### Example: Renaming Customer to Client

**Intent:**

```yaml
- kind: rename_entity
  scope: data
  from: Customer
  to: Client
```

**Schema change:** `export const customers = pgTable("customers", ...)` becomes `export const clients = pgTable("clients", ...)`.

**Migration `drizzle/000N_rename_customer_to_client.sql`:**

```sql
ALTER TABLE "customers" RENAME TO "clients";
```

**Snapshot patch:** rename the table key and name from `customers` to `clients` (see the procedure).

**Follow-up migration:** constraint names include the table name (`customers_email_unique`). The verification `generate` in the procedure produces a second migration that renames those constraints. Keep it. It is generated without prompts.

## Implementing `rename_field` Intent

### Steps

1. **Verify the table and column exist** and the new column name is not taken.

2. **Rename the key** in the table object. Keep the builder and all modifiers.

3. **Update everything that refers to the column**:
   - Indexes and unique constraints in the extra config (`t.{old_field}` → `t.{new_field}`), including their names if they contain the old field name
   - `relations()` `fields` / `references` arrays
   - `.references(() => {table}.{old_field})` in other tables, if the renamed column is a referenced key

4. **Write the migration** with the [Rename Procedure](#rename-procedure) using migration name `rename_{entity_lower}_{old_field}_to_{new_field}` and this SQL:

   ```sql
   ALTER TABLE "{table}" RENAME COLUMN "{old_field}" TO "{new_field}";
   ```

   MySQL and SQLite use the same statement with backticks.

5. **Apply the migration** only when `database.autorun_migrations: true`.

6. **Update application code**: queries, request validation and API response fields. TypeScript reports every usage of the old property name.

### Example: Renaming `name` to `full_name`

**Intent:**

```yaml
- kind: rename_field
  scope: data
  entity: Customer
  from: name
  to: full_name
```

**Schema change:** `name: varchar({ length: 100 }).notNull(),` becomes `full_name: varchar({ length: 100 }).notNull(),`.

**Migration:**

```sql
ALTER TABLE "customers" RENAME COLUMN "name" TO "full_name";
```

## Rename Procedure

Use this for `rename_entity` and `rename_field`. It produces the same files an interactive `drizzle-kit generate` would, without needing a terminal.

**1. Update the schema file** as described in the intent section.

**2. Create an empty custom migration:**

```bash
npx drizzle-kit generate --custom --name {migration_name}
```

This creates `drizzle/{NNNN}_{migration_name}.sql` and `drizzle/meta/{NNNN}_snapshot.json`. The new snapshot is a copy of the previous one. It still has the old name.

**3. Replace the entire contents** of the new `.sql` file with the rename SQL.

**CRITICAL:** drizzle-kit writes a placeholder comment (`-- Custom SQL migration file, put your code below! --`) **without a trailing newline**. Appending to the file puts your SQL on the comment line, where it is silently ignored. `drizzle-kit check` does not detect this. Always overwrite the file:

```bash
printf '%s\n' 'ALTER TABLE "customers" RENAME COLUMN "name" TO "full_name";' > drizzle/{NNNN}_{migration_name}.sql
```

**4. Patch the new snapshot** so it matches the renamed schema. Run this from the project root, setting the four variables:

```bash
node -e '
const fs = require("fs");
const [file, kind, table, from, to] = process.argv.slice(1);
const snap = JSON.parse(fs.readFileSync(file, "utf8"));
// PostgreSQL keys tables as "public.{table}"; MySQL and SQLite use "{table}"
const key = name => (snap.dialect === "postgresql" ? `public.${name}` : name);
if (kind === "column") {
  const cols = snap.tables[key(table)].columns;
  const col = cols[from];
  delete cols[from];
  col.name = to;
  cols[to] = col;
} else {
  const t = snap.tables[key(from)];
  delete snap.tables[key(from)];
  t.name = to;
  snap.tables[key(to)] = t;
  for (const other of Object.values(snap.tables)) {
    for (const fk of Object.values(other.foreignKeys ?? {})) {
      if (fk.tableTo === from) fk.tableTo = to;
      if (fk.tableFrom === from) fk.tableFrom = to;
    }
  }
}
fs.writeFileSync(file, JSON.stringify(snap, null, 2));
' drizzle/meta/{NNNN}_snapshot.json {column|table} {table_for_column_rename_or_dash} {from} {to}
```

- Column rename: `... column customers name full_name`
- Table rename: `... table - customers clients`

**5. Verify** with a normal generate:

```bash
npx drizzle-kit generate --name {migration_name}_constraints
npx drizzle-kit check
```

- For a column rename, expect `No schema changes, nothing to migrate`.
- For a table rename, expect a small migration that renames constraints and indexes whose names contain the old table name. Keep it.
- If `generate` fails with the TTY error, the snapshot patch is wrong. Fix the snapshot. Do not delete migrations.

## Migration Handling

### Standard Migration

**CRITICAL:** Migrations are **always created**, but only **automatically applied** if `database.autorun_migrations: true` in `project.yaml`.

**Step 1: Always create the migration file:**

```bash
npx drizzle-kit generate --name {migration_name}
```

This writes `drizzle/{NNNN}_{migration_name}.sql`, a snapshot in `drizzle/meta/` and an entry in `drizzle/meta/_journal.json`. All three are committed to version control.

**Step 2: Apply the migration** (only if `database.autorun_migrations: true`):

```bash
npx drizzle-kit migrate
```

**If `autorun_migrations` is false or not set:**

- The migration file is created but not applied
- Add to `summary.yaml`: `"Run npx drizzle-kit migrate to apply pending migrations"`

**CRITICAL STEPS:**

1. **Generate** after each intent, not once per intent file: `npx drizzle-kit generate --name {migration_name}`
2. **Review the SQL** in `drizzle/{NNNN}_{migration_name}.sql`
3. **Apply** (only if `autorun_migrations: true`): `npx drizzle-kit migrate`
4. **Check consistency**: `npx drizzle-kit check`
5. **Update TypeScript types** in `packages/types/index.ts`
6. **Update API endpoints** so POST/PATCH handlers accept new fields

### Non-Interactive Generation

drizzle-kit prompts whenever one `generate` run sees a table or column **removed and another added** in the same place, because that could be a rename. Agent shells have no TTY, so the prompt fails.

Avoid it with these rules:

1. **Generate once per intent.** Never batch several intents into one `generate`. An intent file that removes field `a` and adds field `b` to the same entity must produce two migrations.
2. **Order removals before additions** when an intent file both removes and adds in the same table.
3. **Use the [Rename Procedure](#rename-procedure)** for `rename_entity` and `rename_field`.

### Commands Not to Use

- **`drizzle-kit push`**: applies schema changes directly without migration files. It breaks the audit trail and is not allowed for OSL intents.
- **`drizzle-kit drop`**: deletes migration files. Never use it to fix a failed generate.
- **Hand-editing old migrations** or snapshots, except the new snapshot in the Rename Procedure.

### Migration Naming Conventions

- Add entity: `add_{entity_lower}_entity`
- Add field(s): `add_{entity_lower}_{field_name(s)}`
- Remove field(s): `remove_{entity_lower}_{field_name(s)}`
- Remove entity: `remove_{entity_lower}_entity`
- Rename entity: `rename_{old_entity}_to_{new_entity}`
- Rename field: `rename_{entity_lower}_{old_field}_to_{new_field}`
- Add relation: `add_{source_entity}_{target_entity}_relation`

drizzle-kit prefixes each name with a sequence number (`0003_add_customer_entity.sql`). In `plan.yaml`, write the path as `drizzle/NNNN_{migration_name}.sql`. In `summary.yaml`, write the real file name.

## TypeScript Types

**CRITICAL:** Derive entity types from the schema instead of writing interfaces by hand. Derived types stay correct after every intent.

Update `packages/types/index.ts`:

```typescript
import type { customers } from "@/lib/schema";

// Row as returned by select / returning()
export type CustomerInterface = typeof customers.$inferSelect;

// Values accepted by insert (defaults and nullable columns are optional)
export type NewCustomerInterface = typeof customers.$inferInsert;

// Body accepted by PATCH handlers
export type UpdateCustomerInterface = Partial<Omit<NewCustomerInterface, "id">>;

export interface CustomersResponse {
  data: CustomerInterface[];
}
```

**Nullable columns** are typed `T | null` in `$inferSelect`, matching what Drizzle returns. Never write `field?: T` for a nullable column in a select type.

**API responses** serialize `Date` values as ISO strings. If the project defines separate response types for JSON, map `Date` fields to `string` there.

If `packages/types` cannot import from `@/lib/schema` (for example a separate workspace package), write interfaces by hand using the TypeScript value column of the [type mapping table](#field-type-mappings), with `| null` for nullable fields.

## Database Client Usage

```typescript
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/schema";

// Create (PostgreSQL and SQLite support returning())
const [customer] = await db.insert(customers).values({ email: "test@example.com", name: "Test User" }).returning();

// Read many
const active = await db
  .select()
  .from(customers)
  .where(eq(customers.status, "ACTIVE"))
  .orderBy(desc(customers.created_at));

// Read one
const [found] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);

// Read with relations (requires relations() and schema passed to drizzle())
const withTodos = await db.query.users.findMany({ with: { todos: true } });

// Update
const [updated] = await db.update(customers).set({ status: "INACTIVE" }).where(eq(customers.id, id)).returning();

// Delete
const [deleted] = await db.delete(customers).where(eq(customers.id, id)).returning();
```

**MySQL has no `returning()`.** Insert, then select the row by its key:

```typescript
const id = crypto.randomUUID();
await db.insert(customers).values({ id, email, name });
const [customer] = await db.select().from(customers).where(eq(customers.id, id));
```

For an auto-increment key on MySQL, use `.$returningId()`: `const [{ id }] = await db.insert(customers).values({...}).$returningId();`

An empty array from `returning()` or `select()` means no row matched. Return 404 in that case.

## Error Handling

Drizzle wraps driver errors in `DrizzleQueryError`. **The database error code is on `error.cause`, not on the error itself.**

```typescript
import { DrizzleQueryError } from "drizzle-orm";

export function getDbErrorCode(error: unknown): string | undefined {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (typeof cause !== "object" || cause === null) return undefined;
  // libSQL puts the specific code in extendedCode
  const { code, extendedCode } = cause as { code?: string; extendedCode?: string };
  return extendedCode ?? code;
}
```

Put this helper in `lib/db-errors.ts` the first time an endpoint needs it.

| Condition                            | PostgreSQL code | MySQL code               | SQLite (libSQL) code           | HTTP status |
| ------------------------------------ | --------------- | ------------------------ | ------------------------------ | ----------- |
| Unique violation                     | `23505`         | `ER_DUP_ENTRY`           | `SQLITE_CONSTRAINT_UNIQUE`     | 409         |
| Foreign key violation                | `23503`         | `ER_NO_REFERENCED_ROW_2` | `SQLITE_CONSTRAINT_FOREIGNKEY` | 400         |
| Row is still referenced              | `23503`         | `ER_ROW_IS_REFERENCED_2` | `SQLITE_CONSTRAINT_FOREIGNKEY` | 409         |
| NOT NULL violation                   | `23502`         | `ER_BAD_NULL_ERROR`      | `SQLITE_CONSTRAINT_NOTNULL`    | 400         |
| Invalid input syntax (e.g. bad UUID) | `22P02`         | -                        | -                              | 400         |

PostgreSQL and SQLite use one code for both foreign key rows. Decide by the operation: a failing **insert or update** means the referenced row does not exist (400). A failing **delete** means other rows still reference this one (409).

On PostgreSQL, querying a `uuid` column with a malformed string raises `22P02`. Validate path IDs or map `22P02` to 400 so a bad ID does not return 500.

### Common Errors

**`Interactive prompts require a TTY terminal`**

- Cause: one generate run saw both a removal and an addition in the same table, or a rename.
- Solution: follow [Non-Interactive Generation](#non-interactive-generation) and the [Rename Procedure](#rename-procedure).

**`db.query.{table}` is undefined**

- Cause: `drizzle()` was created without `schema`, or the table is not exported from the schema module.
- Solution: pass `schema` as in [Project Setup](#3-create-libdbts) and export every table.

**`There is not enough information to infer relation`**

- Cause: a `one()` without `fields`/`references` has no matching `one(..., { fields, references })` on the other side, or two relations between the same tables have no `relationName`.
- Solution: add the missing side, or add `relationName: "{name}"` to both sides.

**`column "x" of relation "y" contains null values`** while migrating

- Cause: a `.notNull()` column was added to a table with existing rows and no default.
- Solution: report it. The intent needs a `default` or the data must be backfilled first.

## Best Practices

1. **Follow the naming conventions exactly** so API packs can import `@/lib/schema` and `@/lib/db` without guessing
2. **Generate one migration per intent** and never use `drizzle-kit push`
3. **Check `database.autorun_migrations`** before running `drizzle-kit migrate`
4. **Review migration SQL** before applying, especially drops
5. **Run `npx drizzle-kit check`** after generating
6. **Keep exactly one `relations()` export per table**, and define both sides of every relation
7. **Index foreign key columns** explicitly
8. **Derive types** with `$inferSelect` / `$inferInsert` instead of hand-written interfaces
9. **Use identity columns** for auto-increment keys on PostgreSQL
10. **Unwrap `DrizzleQueryError`** before reading database error codes
11. **Commit the whole `drizzle/` folder**, including `meta/`
12. **Run the TypeScript compiler** after schema changes to find code that uses removed or renamed columns
