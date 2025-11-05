# Next.js API Implementation Guide

This guide provides complete implementation instructions for applying OpenIntent API intents when using Next.js as the API framework.

## When to Use This Guide

Use this guide when `api.framework` in `project.yaml` is set to `"nextjs"`.

## Prerequisites

- Next.js 13+ with App Router is installed
- `app/api/` directory exists
- API response format is configured in `project.yaml`

## File Structure Convention

Next.js App Router uses a file-based routing system:

| Intent Path | File Location | Route Handler |
|------------|---------------|---------------|
| `/api/users` | `app/api/users/route.ts` | GET, POST, PATCH, DELETE |
| `/api/users/[id]` | `app/api/users/[id]/route.ts` | GET, PATCH, DELETE by ID |
| `/api/posts` | `app/api/posts/route.ts` | GET, POST, PATCH, DELETE |

**Important:** For routes with dynamic segments (e.g., `[id]`) in Next.js 15+:
- The `request` parameter is required as the first parameter (prefix with `_` if unused to avoid lint warnings)
- The `params` are passed in a context object as the second parameter
- `params` is a Promise that must be awaited:
```typescript
export async function GET(
  _request: Request,  // Prefix with _ when not used
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
      object: data    # Success responses wrap result in "data" field
    error:
      object: error   # Error responses use "error" field
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
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { UserInterface, UserResponse, ErrorResponse } from '@/packages/types';

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      orderBy: { created_at: 'desc' }
    });

    const response: UserResponse = {
      data: users,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching users:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch users'
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
        error: 'Missing required fields: email, name'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
      }
    });

    const response: UserResponse = {
      data: user,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create user'
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
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status');

    const where = status ? { status } : {};
    
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' }
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
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export async function GET(request: Request) {
  // Check authentication
  const session = await getServerSession(authOptions);
  
  if (!session) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: 'Unauthorized'
    };
    return NextResponse.json(errorResponse, { status: 401 });
  }

  // Check role-based access
  if (session.user.role !== 'admin') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: 'Forbidden'
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
        posts: true,      // Include related posts
        profile: true,    // Include related profile
      },
      orderBy: { created_at: 'desc' }
    });

    const response: UserResponse = {
      data: users,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    // ... error handling
  }
}
```

## Status Codes

Use appropriate HTTP status codes:

| Status Code | Usage |
|------------|-------|
| `200` | Successful GET, PATCH, DELETE |
| `201` | Successful POST (created) |
| `400` | Bad request (validation errors) |
| `401` | Unauthorized (not authenticated) |
| `403` | Forbidden (not authorized) |
| `404` | Not found |
| `500` | Internal server error |

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
describe('GET /api/users', () => {
  it('should return list of users', async () => {
    const response = await fetch('http://localhost:3000/api/users');
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data).toHaveProperty('data');
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

