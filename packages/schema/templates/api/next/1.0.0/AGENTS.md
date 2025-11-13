# Next.js API Implementation Guide

> **Template Version:** 1.0.0  
> **Compatible OIML Versions:** 0.1.x  
> **Compatible Next.js Versions:** 14.x.x, 15.x.x, 16.x.x  
> **Last Updated:** 2025-11-06

This guide provides complete implementation instructions for applying OpenIntent API intents when using Next.js as the API framework.

## When to Use This Guide

Use this guide when `api.framework` in `project.yaml` is set to `"next"`.

## Prerequisites

- Next.js 13+ with App Router is installed
- `app/api/` directory exists
- API response format is configured in `project.yaml`

## File Structure Convention

Next.js App Router uses a file-based routing system:

| Intent Path       | File Location                 | Route Handler            |
| ----------------- | ----------------------------- | ------------------------ |
| `/api/users`      | `app/api/users/route.ts`      | GET, POST, PATCH, DELETE |
| `/api/users/[id]` | `app/api/users/[id]/route.ts` | GET, PATCH, DELETE by ID |
| `/api/posts`      | `app/api/posts/route.ts`      | GET, POST, PATCH, DELETE |

**Important:** For routes with dynamic segments (e.g., `[id]`) in Next.js 15+:

- The `request` parameter is required as the first parameter (prefix with `_` if unused to avoid lint warnings)
- The `params` are passed in a context object as the second parameter
- `params` is a Promise that must be awaited:

```typescript
export async function GET(
  _request: Request, // Prefix with _ when not used
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  // ... use resolvedParams.id
}
```

## Implementing `add_endpoint` Intent

### Steps

1. **Read intent** and extract:
   - HTTP method (GET, POST, PATCH, DELETE)
   - Path (e.g., `/api/customers`)
   - Entity name (for scaffolding)
   - Auth requirements (optional)

2. **Read `project.yaml`** to get:
   - `api.response.success.object` (e.g., `"data"`)
   - `api.response.error.object` (e.g., `"error"`)
   - `paths.api` (default: `"app/api"`)
   - `database.framework` (e.g., `"prisma"`)
   - `paths.types` (default: `"packages/types"`)

3. **Convert path to file structure**:
   - `/api/customers` → `app/api/customers/route.ts`
   - `/api/users/[id]` → `app/api/users/[id]/route.ts`

4. **Create directory structure** if it doesn't exist

5. **Generate route handler** based on HTTP method

6. **Import dependencies**:
   - `NextResponse` from `'next/server'`
   - Database client (e.g., Prisma from `'@/lib/prisma'`)
   - TypeScript types from configured types path

7. **Structure response** according to `api.response` configuration

8. **Add error handling** with appropriate status codes

9. **Resolve params** for dynamic routes (Next.js 15+ passes params as Promise in context object)

### Response Structure

Based on `api.response` configuration in `project.yaml`:

```yaml
api:
  response:
    success:
      object: data # Success responses wrap result in "data" field
    error:
      object: error # Error responses use "error" field
```

**Success Response:**

```typescript
{
  data: [...results...]
}
```

**Error Response:**

```typescript
{
  success: false,
  error: "Error message"
}
```

## HTTP Method Templates

### GET - Fetch All Entities

**Use Case:** Retrieve all records of an entity with optional filtering/pagination

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { {Entity}Response, ErrorResponse } from '@/packages/types';

export async function GET() {
  try {
    const {entity_plural} = await prisma.{entity_lower}.findMany({
      orderBy: { created_at: 'desc' }
    });

    // Response structure from api.response.success.object
    const response: {Entity}Response = {
      data: {entity_plural},
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching {entity_plural}:', error);
    // Response structure from api.response.error.object
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch {entity_plural}'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
```

### GET - Fetch Single Entity by ID

**Use Case:** Retrieve one record by its ID

**File:** `app/api/{entity_plural}/[id]/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { {Entity}Response, ErrorResponse } from '@/packages/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Resolve params (Next.js 15+ passes params as a Promise)
  const resolvedParams = await params;

  try {
    const {entity} = await prisma.{entity_lower}.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!{entity}) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: '{Entity} not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: {Entity}Response = {
      data: {entity},
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching {entity}:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch {entity}'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
```

### POST - Create New Entity

**Use Case:** Create a new record

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { {Entity}Interface, {Entity}Response, ErrorResponse } from '@/packages/types';

export async function POST(request: Request) {
  try {
    const body: Partial<{Entity}Interface> = await request.json();

    // Validate required fields
    if (!body.field1 || !body.field2) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Missing required fields: field1, field2'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const {entity} = await prisma.{entity_lower}.create({
      data: {
        field1: body.field1,
        field2: body.field2,
        field3: body.field3,
      }
    });

    const response: {Entity}Response = {
      data: {entity},
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating {entity}:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create {entity}'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
```

### PATCH - Update Entity

**Use Case:** Update an existing record

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { {Entity}Interface, {Entity}Response, ErrorResponse } from '@/packages/types';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Resolve params (Next.js 15+ passes params as a Promise)
  const resolvedParams = await params;

  try {
    const body: Partial<{Entity}Interface> = await request.json();

    // Check if entity exists
    const existing = await prisma.{entity_lower}.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: '{Entity} not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const {entity} = await prisma.{entity_lower}.update({
      where: { id: resolvedParams.id },
      data: body
    });

    const response: {Entity}Response = {
      data: {entity},
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error updating {entity}:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update {entity}'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
```

### DELETE - Remove Entity

**Use Case:** Delete a record by ID

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ErrorResponse } from '@/packages/types';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Resolve params (Next.js 15+ passes params as a Promise)
  const resolvedParams = await params;

  try {
    // Check if entity exists
    const existing = await prisma.{entity_lower}.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: '{Entity} not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    await prisma.{entity_lower}.delete({
      where: { id: resolvedParams.id }
    });

    return NextResponse.json(
      { success: true, message: '{Entity} deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting {entity}:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete {entity}'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
```

## Complete Example: User API Endpoints

### Intent File

```yaml
version: "0.1.0"
intents:
  - kind: add_endpoint
    scope: api
    method: GET
    path: /api/users
    entity: User

  - kind: add_endpoint
    scope: api
    method: POST
    path: /api/users
    entity: User
```

### Generated File: `app/api/users/route.ts`

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { UserInterface, UserResponse, ErrorResponse } from "@/packages/types";

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      orderBy: { created_at: "desc" }
    });

    const response: UserResponse = {
      data: users
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching users:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch users"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: Partial<UserInterface> = await request.json();

    if (!body.email || !body.name) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Missing required fields: email, name"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name
      }
    });

    const response: UserResponse = {
      data: user
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create user"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
```

## Advanced Features

### Query Parameters

**GET with filtering/pagination:**

```typescript
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const status = searchParams.get("status");

    const where = status ? { status } : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: "desc" }
      }),
      prisma.user.count({ where })
    ]);

    const response = {
      data: users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    // ... error handling
  }
}
```

### Authentication

**Protected endpoint example:**

```typescript
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(request: Request) {
  // Check authentication
  const session = await getServerSession(authOptions);

  if (!session) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: "Unauthorized"
    };
    return NextResponse.json(errorResponse, { status: 401 });
  }

  // Check role-based access
  if (session.user.role !== "admin") {
    const errorResponse: ErrorResponse = {
      success: false,
      error: "Forbidden"
    };
    return NextResponse.json(errorResponse, { status: 403 });
  }

  try {
    // ... endpoint logic
  } catch (error) {
    // ... error handling
  }
}
```

### Relations in Responses

**Include related entities:**

```typescript
export async function GET() {
  try {
    const users = await prisma.user.findMany({
      include: {
        posts: true, // Include related posts
        profile: true // Include related profile
      },
      orderBy: { created_at: "desc" }
    });

    const response: UserResponse = {
      data: users
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    // ... error handling
  }
}
```

## Implementing `update_endpoint` Intent

### Overview

The `update_endpoint` intent allows you to modify existing API endpoints to include additional fields in the response. This is useful for:

- Adding relations to GET endpoints
- Including specific fields from related entities
- Joining on foreign keys to add fields from other entities
- Adding computed fields

### Steps

1. **Read intent** and extract:
   - HTTP method and path of the endpoint to update
   - `updates.add_field` array with field definitions
   - Field source types (`relation`, `field`, `computed`)

2. **Locate the existing route handler file** (e.g., `app/api/artists/route.ts`)

3. **Update the handler function** based on field source types:
   - **`type: "relation"`**: Use Prisma's `include` option
   - **`type: "field"`**: Use `include` with `select` or transform response
   - **`type: "computed"`**: Add computation logic in handler

4. **Update TypeScript types** if needed to reflect new response structure

### Field Source Types

#### Type: `relation` - Include Full Relation

**Use Case:** Include a related entity in the response (e.g., albums for an artist)

**Intent Example:**

```yaml
- kind: update_endpoint
  scope: api
  method: GET
  path: /api/v1/artists
  updates:
    add_field:
      - name: albums
        source:
          type: relation
          relation: albums
```

**Implementation:**

```typescript
export async function GET() {
  try {
    const artists = await prisma.artist.findMany({
      include: {
        albums: true // Added: Include albums relation
      },
      orderBy: { created_at: "desc" }
    });

    const response: ArtistResponse = {
      data: artists
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching artists:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch artists"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
```

#### Type: `field` - Select Specific Field from Relation

**Use Case:** Include a specific field from a related entity (e.g., album count)

**Intent Example:**

```yaml
- kind: update_endpoint
  scope: api
  method: GET
  path: /api/v1/artists
  updates:
    add_field:
      - name: album_count
        source:
          type: relation
          relation: albums
          entity: Album
          field: count
```

**Implementation:**

```typescript
export async function GET() {
  try {
    const artists = await prisma.artist.findMany({
      include: {
        albums: true
      },
      orderBy: { created_at: "desc" }
    });

    // Transform response to include computed field
    const artistsWithCount = artists.map(artist => ({
      ...artist,
      album_count: artist.albums.length // Computed field
    }));

    const response: ArtistResponse = {
      data: artistsWithCount
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    // ... error handling
  }
}
```

#### Type: `field` with `join` - Join on Foreign Key

**Use Case:** Join on a foreign key and include a field from the joined entity

**Intent Example:**

```yaml
- kind: update_endpoint
  scope: api
  method: GET
  path: /api/v1/albums/{id}
  updates:
    add_field:
      - name: artist_name
        source:
          type: field
          entity: Artist
          field: name
          join:
            foreign_key: artist_id
            target_entity: Artist
            target_field: name
```

**Implementation:**

```typescript
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const album = await prisma.album.findUnique({
      where: { id: resolvedParams.id },
      include: {
        artist: {
          select: {
            name: true // Select only the name field
          }
        }
      }
    });

    if (!album) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Album not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Transform to include artist_name field
    const response = {
      data: {
        ...album,
        artist_name: album.artist.name // Field from joined entity
      }
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching album:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch album"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
```

#### Type: `computed` - Add Computed Field

**Use Case:** Add a field that is computed in the handler (not from database)

**Intent Example:**

```yaml
- kind: update_endpoint
  scope: api
  method: GET
  path: /api/v1/artists
  updates:
    add_field:
      - name: total_streams
        source:
          type: computed
```

**Implementation:**

```typescript
export async function GET() {
  try {
    const artists = await prisma.artist.findMany({
      orderBy: { created_at: "desc" }
    });

    // Transform to include computed field
    const artistsWithStreams = await Promise.all(
      artists.map(async artist => {
        // Compute total_streams (example: sum from albums)
        const totalStreams = await computeTotalStreams(artist.id);

        return {
          ...artist,
          total_streams: totalStreams // Computed field
        };
      })
    );

    const response: ArtistResponse = {
      data: artistsWithStreams
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    // ... error handling
  }
}

async function computeTotalStreams(artistId: string): Promise<number> {
  // Your computation logic here
  const albums = await prisma.album.findMany({
    where: { artist_id: artistId },
    include: { streams: true }
  });
  return albums.reduce((sum, album) => sum + album.streams.length, 0);
}
```

### Complete Example: Updating GET /api/v1/artists

**Intent:**

```yaml
- kind: update_endpoint
  scope: api
  method: GET
  path: /api/v1/artists
  updates:
    add_field:
      - name: albums
        source:
          type: relation
          relation: albums
```

**Before (Original Handler):**

```typescript
export async function GET() {
  try {
    const artists = await prisma.artist.findMany({
      orderBy: { created_at: "desc" }
    });

    const response: ArtistResponse = {
      data: artists
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    // ... error handling
  }
}
```

**After (Updated Handler):**

```typescript
export async function GET() {
  try {
    const artists = await prisma.artist.findMany({
      include: {
        albums: true // Added: Include albums relation
      },
      orderBy: { created_at: "desc" }
    });

    const response: ArtistResponse = {
      data: artists
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    // ... error handling
  }
}
```

### Best Practices for `update_endpoint`

1. **Use Prisma's `include`** for relations to avoid N+1 queries
2. **Use `select`** when you only need specific fields from relations
3. **Transform responses** when adding computed fields or specific fields from relations
4. **Update TypeScript types** to reflect new response structure
5. **Maintain backward compatibility** - existing fields should still be present
6. **Handle null relations** gracefully (e.g., `album.artist?.name`)
7. **Consider performance** - including multiple large relations can be slow
8. **Use `Promise.all()`** for parallel computations when adding multiple computed fields

## Status Codes

Use appropriate HTTP status codes:

| Status Code | Usage                            |
| ----------- | -------------------------------- |
| `200`       | Successful GET, PATCH, DELETE    |
| `201`       | Successful POST (created)        |
| `400`       | Bad request (validation errors)  |
| `401`       | Unauthorized (not authenticated) |
| `403`       | Forbidden (not authorized)       |
| `404`       | Not found                        |
| `500`       | Internal server error            |

## Error Handling Best Practices

1. **Always catch errors** and return proper error responses
2. **Log errors** with `console.error()` for debugging
3. **Use typed error responses** following `api.response.error` config
4. **Validate input** before database operations
5. **Check for existence** before update/delete operations
6. **Return appropriate status codes**
7. **Never expose sensitive error details** to clients

## TypeScript Types

Ensure proper types are defined in `packages/types/index.ts`:

```typescript
// Entity interface
export interface UserInterface {
  id: string;
  email: string;
  name: string;
  created_at: Date;
}

// Response types (based on api.response configuration)
export interface UserResponse {
  data: UserInterface | UserInterface[];
}

export interface ErrorResponse {
  success: false;
  error: string;
}
```

## Testing Endpoints

Use tools like:

- **curl**: `curl http://localhost:3000/api/users`
- **Postman**: Create requests for each endpoint
- **Thunder Client** (VS Code): Test directly in editor
- **Jest/Vitest**: Write automated tests

Example test:

```typescript
describe("GET /api/users", () => {
  it("should return list of users", async () => {
    const response = await fetch("http://localhost:3000/api/users");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("data");
    expect(Array.isArray(data.data)).toBe(true);
  });
});
```

## Common Patterns

### Validation Helper

```typescript
function validateRequired(body: any, fields: string[]): string | null {
  for (const field of fields) {
    if (!body[field]) {
      return `Missing required field: ${field}`;
    }
  }
  return null;
}
```

### Error Response Helper

```typescript
function errorResponse(message: string, status: number = 500) {
  const errorResponse: ErrorResponse = {
    success: false,
    error: message
  };
  return NextResponse.json(errorResponse, { status });
}
```

### Success Response Helper

```typescript
function successResponse(data: any, status: number = 200) {
  return NextResponse.json({ data }, { status });
}
```

## Handling Data Intent Side Effects on APIs

When data intents (`remove_entity`, `rename_entity`, `rename_field`) are applied to the database schema, API endpoints that reference those entities or fields **must be updated** to prevent breakage. This section provides guidance on handling these side effects.

### `remove_entity` Intent - API Impact

**Impact:** Any endpoint that uses the removed entity will break.

**Steps to Handle:**

1. **Identify affected endpoints**:
   - Search for all route handlers that reference the entity
   - Check for:
     - Route paths containing the entity name (e.g., `/api/customers/`)
     - Import statements for entity types
     - Prisma queries using the entity (`prisma.customer.*`)
     - TypeScript interfaces for the entity

2. **Delete or deprecate endpoints**:
   - **Option A - Delete immediately**: Remove the entire route handler file
   - **Option B - Soft deprecation**: Return 410 Gone status:
     ```typescript
     export async function GET() {
       return NextResponse.json(
         {
           success: false,
           error: "This endpoint has been removed. The {Entity} resource is no longer available."
         },
         { status: 410 } // 410 Gone
       );
     }
     ```

3. **Remove related TypeScript types**:
   - Delete interface definitions from `packages/types/index.ts`
   - Remove response types (`{Entity}Response`, `{Entity}Interface`)

4. **Update dependent endpoints**:
   - If other entities have relations to the removed entity, update those endpoints
   - Remove `include` statements for the removed relation
   - Remove fields from response types

### Example: Handling `remove_entity` for Customer

**Intent:**

```yaml
- kind: remove_entity
  scope: data
  entity: Customer
  cascade: false
```

**Actions:**

1. **Delete route files**:
   - `app/api/customers/route.ts` (DELETE this file)
   - `app/api/customers/[id]/route.ts` (DELETE this file)

2. **Update `packages/types/index.ts`**:

```typescript
// REMOVE these types:
// export interface CustomerInterface { ... }
// export interface CustomerResponse { ... }
```

3. **Update related endpoints** (if Order entity had a customer relation):

**Before:**

```typescript
// app/api/orders/route.ts
export async function GET() {
  const orders = await prisma.order.findMany({
    include: {
      customer: true // This will break after Customer is removed
    }
  });
  return NextResponse.json({ data: orders });
}
```

**After:**

```typescript
// app/api/orders/route.ts
export async function GET() {
  const orders = await prisma.order.findMany({
    // Remove customer include - relation no longer exists
  });
  return NextResponse.json({ data: orders });
}
```

### `rename_entity` Intent - API Impact

**Impact:** Endpoint paths, import statements, database queries, and type definitions need updates.

**Steps to Handle:**

1. **Rename route directories**:
   - From: `app/api/{old_entity_plural}/`
   - To: `app/api/{new_entity_plural}/`

2. **Update route handler imports**:
   - Update Prisma client calls: `prisma.{old_entity}` → `prisma.{new_entity}`
   - Update type imports: `{OldEntity}Interface` → `{NewEntity}Interface`

3. **Update TypeScript types** in `packages/types/index.ts`:
   - Rename interfaces: `{OldEntity}Interface` → `{NewEntity}Interface`
   - Rename response types: `{OldEntity}Response` → `{NewEntity}Response`

4. **Update all references** in other endpoints:
   - Search for relation includes: `include: { old_entity: true }`
   - Update to: `include: { new_entity: true }`

### Example: Handling `rename_entity` from Customer to Client

**Intent:**

```yaml
- kind: rename_entity
  scope: data
  from: Customer
  to: Client
```

**Actions:**

1. **Rename directories**:
   - `app/api/customers/` → `app/api/clients/`
   - `app/api/customers/[id]/` → `app/api/clients/[id]/`

2. **Update route handler** (`app/api/clients/route.ts`):

**Before:**

```typescript
import type { CustomerInterface, CustomerResponse } from "@/packages/types";

export async function GET() {
  const customers = await prisma.customer.findMany();
  const response: CustomerResponse = { data: customers };
  return NextResponse.json(response);
}
```

**After:**

```typescript
import type { ClientInterface, ClientResponse } from "@/packages/types";

export async function GET() {
  const clients = await prisma.client.findMany();
  const response: ClientResponse = { data: clients };
  return NextResponse.json(response);
}
```

3. **Update types** (`packages/types/index.ts`):

**Before:**

```typescript
export interface CustomerInterface {
  id: string;
  email: string;
  name: string;
}

export interface CustomerResponse {
  data: CustomerInterface | CustomerInterface[];
}
```

**After:**

```typescript
export interface ClientInterface {
  id: string;
  email: string;
  name: string;
}

export interface ClientResponse {
  data: ClientInterface | ClientInterface[];
}
```

### `rename_field` Intent - API Impact

**Impact:** Request validation, database queries, and response types need field name updates.

**Steps to Handle:**

1. **Update request body validation**:
   - In POST/PATCH handlers, update field names in validation checks
   - Update destructured field names from request body

2. **Update Prisma queries**:
   - Update `create()` calls with new field name
   - Update `update()` calls with new field name
   - Update `select` statements if field is explicitly selected

3. **Update TypeScript types** in `packages/types/index.ts`:
   - Rename field in entity interface

4. **Update API documentation**:
   - Update field names in comments
   - Update example requests/responses

### Example: Handling `rename_field` from 'name' to 'full_name'

**Intent:**

```yaml
- kind: rename_field
  scope: data
  entity: Customer
  from: name
  to: full_name
```

**Actions:**

1. **Update POST handler** (`app/api/customers/route.ts`):

**Before:**

```typescript
export async function POST(request: Request) {
  const body: Partial<CustomerInterface> = await request.json();

  if (!body.email || !body.name) {
    // Validation
    return NextResponse.json({ success: false, error: "Missing required fields: email, name" }, { status: 400 });
  }

  const customer = await prisma.customer.create({
    data: {
      email: body.email,
      name: body.name // Old field name
    }
  });

  return NextResponse.json({ data: customer }, { status: 201 });
}
```

**After:**

```typescript
export async function POST(request: Request) {
  const body: Partial<CustomerInterface> = await request.json();

  if (!body.email || !body.full_name) {
    // Updated validation
    return NextResponse.json({ success: false, error: "Missing required fields: email, full_name" }, { status: 400 });
  }

  const customer = await prisma.customer.create({
    data: {
      email: body.email,
      full_name: body.full_name // New field name
    }
  });

  return NextResponse.json({ data: customer }, { status: 201 });
}
```

2. **Update PATCH handler** (`app/api/customers/[id]/route.ts`):

**Before:**

```typescript
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const body: Partial<CustomerInterface> = await request.json();

  const customer = await prisma.customer.update({
    where: { id: resolvedParams.id },
    data: body // This will work if body uses new field name
  });

  return NextResponse.json({ data: customer });
}
```

**After:**

```typescript
// No changes needed if using spread operator with body
// But if you're explicitly setting fields:
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const body: Partial<CustomerInterface> = await request.json();

  const updateData: any = {};
  if (body.email !== undefined) updateData.email = body.email;
  if (body.full_name !== undefined) updateData.full_name = body.full_name; // Updated

  const customer = await prisma.customer.update({
    where: { id: resolvedParams.id },
    data: updateData
  });

  return NextResponse.json({ data: customer });
}
```

3. **Update TypeScript types** (`packages/types/index.ts`):

**Before:**

```typescript
export interface CustomerInterface {
  id: string;
  email: string;
  name: string; // Old field name
  created_at: Date;
}
```

**After:**

```typescript
export interface CustomerInterface {
  id: string;
  email: string;
  full_name: string; // New field name
  created_at: Date;
}
```

### Best Practices for Handling Data Intent Side Effects

1. **Search globally** for entity/field references before making changes
2. **Update types first**, then let TypeScript errors guide you to all affected endpoints
3. **Test all affected endpoints** after updates
4. **Consider API versioning** for breaking changes (e.g., `/api/v1/` vs `/api/v2/`)
5. **Document breaking changes** in API changelog
6. **Use deprecation periods** for public APIs rather than immediate removal
7. **Update API documentation** (OpenAPI/Swagger specs) alongside code changes
8. **Check for hardcoded strings** - search for entity/field names in string literals
9. **Update tests** for affected endpoints
10. **Coordinate with frontend** teams if endpoints are consumed by UI

## Best Practices

1. **Follow REST conventions** for method usage
2. **Use TypeScript types** for all requests/responses
3. **Structure responses consistently** per `project.yaml` config
4. **Handle errors gracefully** with proper status codes
5. **Validate input** before processing
6. **Always resolve params** in dynamic routes: accept `request` (or `_request` if unused) as first parameter, `params` as Promise in context object, and await it: `const resolvedParams = await params` (Next.js 15+ required)
7. **Use Next.js caching** where appropriate (`export const revalidate = 60`)
8. **Keep route handlers focused** - one responsibility per file
9. **Use middleware** for cross-cutting concerns (auth, logging)
10. **Document API endpoints** with comments or OpenAPI spec
11. **Test thoroughly** before deploying
12. **Handle data intent side effects** - when entities/fields are removed or renamed, update all affected API endpoints
