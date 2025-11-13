# NextAuth Auth Capability Implementation Guide

> **Template Version:** 1.0.0  
> **Compatible OIML Versions:** 0.1.x  
> **Compatible Next.js Versions:** 16.0.x  
> **Compatible NextAuth Versions:** 5.0.0-beta.x  
> **Last Updated:** 2025-01-27

This guide provides complete implementation instructions for adding authentication to Next.js applications using NextAuth v5 with the `add_capability` intent.

## When to Use This Guide

Use this guide when:

- `api.framework` in `project.yaml` is set to `"next"`
- An `add_capability` intent with `capability: "auth"` and `framework: "next"` (or `framework: "next-auth"`) is being applied
- You need to implement NextAuth-based authentication for your Next.js API

## Prerequisites

- Node.js 18+ is installed
- Next.js 16+ is installed
- NextAuth v5: `npm install next-auth@beta`
- Password hashing: `npm install bcryptjs` and `npm install -D @types/bcryptjs`
- Database client is configured (any ORM or database library: Prisma, Drizzle, TypeORM, raw SQL, etc.)
- **Optional:** Prisma adapter: `npm install @auth/prisma-adapter` (only if using Prisma)

## Overview

The auth capability implements:

- **NextAuth v5** with Credentials provider
- **JWT session strategy** for stateless authentication
- **Password hashing** using `bcryptjs`
- **Middleware** for protecting API routes
- **Login and registration endpoints** for user authentication
- **Database-agnostic** implementation (works with any database/ORM)
- **Type-safe sessions** with TypeScript

## Intent Structure

```yaml
intents:
  - kind: add_capability
    scope: capability
    capability: auth
    framework: next
    provider: jwt
    config:
      secret: env:AUTH_SECRET
      expiration_hours: 24
      refresh_expiration_hours: 168 # 7 days (not used with JWT strategy)
    endpoints:
      - group: /api/*
```

### Endpoint Group Property

The `group` property allows you to specify which route group should be protected by auth middleware. This is particularly useful when you want to apply authentication to an entire group of endpoints.

**Wildcard Support:**

- Use `*` as a wildcard to match all endpoints in a route group
- Example: `group: /api/*` applies auth middleware to all routes under `/api/`
- Example: `group: /api/v1/*` applies auth middleware to all routes under `/api/v1/`

**Usage Examples:**

```yaml
# Protect all endpoints in /api/* group
endpoints:
  - group: /api/*

# Protect specific route groups
endpoints:
  - group: /api/v1/*
  - group: /api/admin/*
```

**Implementation Note:** When a `group` is specified with a wildcard, the auth middleware should be applied in `middleware.ts` using Next.js middleware. See Step 5 for details.

## Implementation Steps

**Important:** Before creating any files, check if they already exist. The following steps will create:

- `auth.ts` - NextAuth configuration
- `app/api/auth/[...nextauth]/route.ts` - NextAuth API handlers
- `app/api/auth/login/route.ts` - Custom login endpoint
- `app/api/auth/register/route.ts` - User registration endpoint
- `middleware.ts` - Route protection middleware
- `types/next-auth.d.ts` - Type declarations

If any of these files already exist, review them and update as needed rather than overwriting.

### Step 1: Verify User Entity

The auth adapter requires a `User` entity with at minimum:

- `email` (string, unique, required)
- `password` (string, optional initially, then required for new users) - will store bcrypt hash
- `id` (integer or UUID, primary key)
- `name` (string, optional) - recommended for user display

**If the User entity doesn't exist**, you must first apply an `add_entity` intent:

```yaml
intents:
  - kind: add_entity
    scope: data
    entity: User
    fields:
      - name: id
        type: integer
        required: true
        default: auto_increment
      - name: email
        type: string
        max_length: 255
        required: true
        unique: true
      - name: password
        type: string
        required: false
      - name: name
        type: string
        max_length: 255
        required: false
```

**If the User entity exists but lacks required fields**, apply an `add_field` intent to add missing fields.

### Step 2: Install Dependencies

Add the required packages to `package.json`:

```bash
npm install next-auth@beta bcryptjs
npm install -D @types/bcryptjs
```

Or with pnpm:

```bash
pnpm add next-auth@beta bcryptjs
pnpm add -D @types/bcryptjs
```

**If using Prisma**, also install the Prisma adapter:

```bash
npm install @auth/prisma-adapter
# or
pnpm add @auth/prisma-adapter
```

**Note:** The Prisma adapter is optional. If you're using a different database library (Drizzle, TypeORM, raw SQL, etc.), you can skip it and implement database access directly in the auth handlers.

### Step 3: Create NextAuth Configuration

Create `auth.ts` in the project root. The configuration is database-agnostic - replace the database access code with your own database client:

```typescript
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import type { NextAuthConfig } from "next-auth";

// Import your database client/ORM here
// Examples:
// import { prisma } from "@/lib/prisma"; // Prisma
// import { db } from "@/lib/db"; // Drizzle, TypeORM, etc.
// import { query } from "@/lib/database"; // Raw SQL

// Optional: If using Prisma, import the adapter
// import { PrismaAdapter } from "@auth/prisma-adapter";

// Helper function to find user by email (replace with your database query)
async function findUserByEmail(email: string) {
  // Example with Prisma:
  // return await prisma.user.findUnique({ where: { email } });

  // Example with raw SQL:
  // const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  // return result.rows[0];

  // Example with Drizzle:
  // return await db.select().from(users).where(eq(users.email, email)).limit(1)[0];

  // Replace with your actual database query
  throw new Error("Implement findUserByEmail with your database client");
}

export const authConfig = {
  // Optional: Only include adapter if using Prisma
  // adapter: PrismaAdapter(prisma) as any,

  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // Find user using your database client
        const user = await findUserByEmail(credentials.email as string);

        if (!user || !user.password) {
          return null;
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(credentials.password as string, user.password);

        if (!isPasswordValid) {
          return null;
        }

        // Return user data (password excluded)
        return {
          id: user.id.toString(),
          email: user.email,
          name: user.name || undefined
        };
      }
    })
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60 // 24 hours (from intent config)
  },
  pages: {
    signIn: "/auth/signin"
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = token.name as string;
      }
      return session;
    }
  }
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
```

**Configuration Notes:**

- `adapter`: Optional - only include if using Prisma (`PrismaAdapter(prisma)`)
- `session.strategy: "jwt"`: Uses JWT tokens stored in cookies (stateless)
- `maxAge`: Session expiration in seconds (default: 24 hours)
- `callbacks`: Extend JWT token and session with user data
- `findUserByEmail`: Replace this helper function with your actual database query

**Database-Specific Examples:**

**Prisma:**

```typescript
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const authConfig = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    Credentials({
      async authorize(credentials) {
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string }
        });
        // ... rest of authorize logic
      }
    })
  ]
  // ... rest of config
};
```

**Raw SQL (PostgreSQL with pg):**

```typescript
import { query } from "@/lib/database"; // Your database connection

async function findUserByEmail(email: string) {
  const result = await query("SELECT * FROM users WHERE email = $1", [email]);
  return result.rows[0] || null;
}
```

**Drizzle ORM:**

```typescript
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

async function findUserByEmail(email: string) {
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] || null;
}
```

### Step 4: Create NextAuth API Route Handler

Create `app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

This creates the following NextAuth endpoints automatically:

- `GET/POST /api/auth/signin` - Sign in page/handler
- `GET/POST /api/auth/signout` - Sign out handler
- `GET /api/auth/session` - Get current session
- `GET /api/auth/csrf` - Get CSRF token
- `GET /api/auth/providers` - Get available providers

### Step 5: Create Login Endpoint

**CRITICAL:** Check if the route already exists before creating. Verify if `app/api/auth/login/route.ts` exists. If it does, review and update it rather than overwriting.

**File location:** `app/api/auth/login/route.ts` (based on `paths.api: app/api` from `project.yaml`)

Create `app/api/auth/login/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import bcrypt from "bcryptjs";
import type { ErrorResponse } from "@/packages/types";

// Import your database client/ORM here
// Examples:
// import { prisma } from "@/lib/prisma"; // Prisma
// import { db } from "@/lib/db"; // Drizzle, TypeORM, etc.
// import { query } from "@/lib/database"; // Raw SQL

// Helper function to find user by email (replace with your database query)
async function findUserByEmail(email: string) {
  // Example with Prisma:
  // return await prisma.user.findUnique({ where: { email } });

  // Example with raw SQL:
  // const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  // return result.rows[0];

  // Replace with your actual database query
  throw new Error("Implement findUserByEmail with your database client");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Email and password are required"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Find user by email (include password for verification)
    const user = await findUserByEmail(email);

    if (!user || !user.password) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Invalid email or password"
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Invalid email or password"
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    // Create session using NextAuth signIn
    // This will set the session cookie automatically
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false
      });

      // If signIn returns an error, handle it
      if (result?.error) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: "Authentication failed"
        };
        return NextResponse.json(errorResponse, { status: 401 });
      }
    } catch (error) {
      // signIn might throw for various reasons
      console.error("SignIn error:", error);
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Failed to create session"
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    // Return user data (password excluded)
    // Follow api.response.success.object configuration from project.yaml
    // Default to { data: ... } if not configured
    return NextResponse.json(
      {
        success: true,
        data: {
          id: user.id,
          email: user.email,
          name: user.name
        }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error logging in:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to log in"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
```

**Database-Specific Examples:**

**Prisma:**

```typescript
import { prisma } from "@/lib/prisma";

async function findUserByEmail(email: string) {
  return await prisma.user.findUnique({ where: { email } });
}
```

**Raw SQL (PostgreSQL with pg):**

```typescript
import { query } from "@/lib/database";

async function findUserByEmail(email: string) {
  const result = await query("SELECT * FROM users WHERE email = $1", [email]);
  return result.rows[0] || null;
}
```

**Drizzle ORM:**

```typescript
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

async function findUserByEmail(email: string) {
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] || null;
}
```

### Step 6: Create Registration Endpoint

**CRITICAL:** Check if the route already exists before creating. Verify if `app/api/auth/register/route.ts` exists. If it does, review and update it rather than overwriting.

**File location:** `app/api/auth/register/route.ts` (based on `paths.api: app/api` from `project.yaml`)

Create `app/api/auth/register/route.ts`:

```typescript
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { ErrorResponse } from "@/packages/types";

// Import your database client/ORM here
// Examples:
// import { prisma } from "@/lib/prisma"; // Prisma
// import { db } from "@/lib/db"; // Drizzle, TypeORM, etc.
// import { query } from "@/lib/database"; // Raw SQL

// Helper functions (replace with your database queries)
async function findUserByEmail(email: string) {
  // Replace with your actual database query
  throw new Error("Implement findUserByEmail with your database client");
}

async function createUser(data: { email: string; password: string; name?: string | null }) {
  // Replace with your actual database insert/create query
  // Should return the created user (without password)
  throw new Error("Implement createUser with your database client");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, name } = body;

    if (!email || !password) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Email and password are required"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Check if user already exists
    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "User with this email already exists"
      };
      return NextResponse.json(errorResponse, { status: 409 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await createUser({
      email,
      password: hashedPassword,
      name: name || null
    });

    return NextResponse.json({ data: user }, { status: 201 });
  } catch (error) {
    console.error("Error registering user:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to register user"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
```

**Database-Specific Examples:**

**Prisma:**

```typescript
import { prisma } from "@/lib/prisma";

async function findUserByEmail(email: string) {
  return await prisma.user.findUnique({ where: { email } });
}

async function createUser(data: { email: string; password: string; name?: string | null }) {
  return await prisma.user.create({
    data: {
      email: data.email,
      password: data.password,
      name: data.name || null
    },
    select: {
      id: true,
      email: true,
      name: true
    }
  });
}
```

**Raw SQL (PostgreSQL with pg):**

```typescript
import { query } from "@/lib/database";

async function findUserByEmail(email: string) {
  const result = await query("SELECT * FROM users WHERE email = $1", [email]);
  return result.rows[0] || null;
}

async function createUser(data: { email: string; password: string; name?: string | null }) {
  const result = await query(
    "INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name",
    [data.email, data.password, data.name]
  );
  return result.rows[0];
}
```

**Drizzle ORM:**

```typescript
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

async function findUserByEmail(email: string) {
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] || null;
}

async function createUser(data: { email: string; password: string; name?: string | null }) {
  const result = await db
    .insert(users)
    .values({
      email: data.email,
      password: data.password,
      name: data.name
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name
    });
  return result[0];
}
```

### Step 7: Create Middleware for Route Protection

**CRITICAL:** Create `middleware.ts` in the project root (same level as `package.json`). This file is required for route protection.

Create `middleware.ts`:

```typescript
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth(req => {
  const { pathname } = req.nextUrl;

  // Public routes that don't require authentication
  const publicRoutes = [
    "/api/auth", // Authentication endpoints (login, register, etc.)
    "/api/health", // Health check endpoint (if exists)
    "/api/public" // Public API endpoints (if exists)
  ];

  // Check if the current path is a public route
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

  // Protect all /api routes except public routes
  if (pathname.startsWith("/api") && !isPublicRoute) {
    // Check if user is authenticated
    if (!req.auth) {
      // Read api.response.error configuration from project.yaml
      // Default to { success: false, error: "..." } if not configured
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all API routes
     * The middleware function will exclude /api/auth/* routes
     * Using regex pattern that Next.js middleware supports (not route syntax like /api/:path*)
     */
    "/api/(.*)"
  ]
};
```

**CRITICAL Notes:**

- **File location**: `middleware.ts` must be in the project root (same level as `package.json`)
- **Matcher pattern**: `/api/(.*)` uses regex syntax that Next.js middleware supports (NOT route syntax like `/api/:path*`)
- **Restart required**: After creating or modifying `middleware.ts`, **restart your Next.js dev server** for changes to take effect
- **Public routes**: Add any additional public routes to the `publicRoutes` array (e.g., health checks, public API endpoints, OpenAPI docs)
- **Response format**: Follow `api.response.error` configuration from `project.yaml` for error responses
- **Middleware execution**: The middleware runs on all `/api/*` routes, but the function logic excludes public routes

**Handling Group Wildcards:**

When the intent specifies a `group` property with a wildcard (e.g., `group: /api/*`), update the middleware accordingly:

```typescript
export default auth(req => {
  const { pathname } = req.nextUrl;

  // Public routes
  const publicRoutes = ["/api/auth"];

  // If intent specifies group: /api/* (protect all /api routes except auth)
  if (pathname.startsWith("/api") && !publicRoutes.some(route => pathname.startsWith(route))) {
    if (!req.auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  // If intent specifies group: /api/v1/* (protect only v1 routes)
  // if (pathname.startsWith("/api/v1")) {
  //   if (!req.auth) {
  //     return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  //   }
  // }

  // Multiple groups can be protected
  // const protectedPaths = ["/api/v1", "/api/admin"];
  // if (protectedPaths.some(path => pathname.startsWith(path))) {
  //   if (!req.auth) {
  //     return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  //   }
  // }

  return NextResponse.next();
});
```

**IMPORTANT:**

- The `group` property in the intent is informational - it tells you which route groups should be protected
- You must implement the middleware logic accordingly based on the `group` value
- Uncomment and adapt the appropriate protection logic based on your intent's `group` configuration
- Always exclude `/api/auth` routes from protection

### Step 8: Create Type Declarations

Create `types/next-auth.d.ts`:

```typescript
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
    };
  }

  interface User {
    id: string;
    email: string;
    name?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    email: string;
    name?: string | null;
  }
}
```

This extends NextAuth's types to include the `id` field in sessions and JWTs.

### Step 9: Access Session in API Routes

In protected API routes, access the session using the `auth()` function:

```typescript
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // Use session.user.id, session.user.email, etc.
  const userId = session.user.id;

  // Your protected route logic here
  return NextResponse.json({ data: { userId } });
}
```

**Note:** The middleware handles authentication checks, but you can also check sessions directly in route handlers for fine-grained control.

### Step 10: Update Database Schema

After adding the password field to your User model/table, run the appropriate migration command for your database setup:

**Prisma:**

```bash
npx prisma migrate dev --name add_password_to_user
npx prisma generate
```

**Drizzle:**

```bash
npm run db:push  # or your migration command
```

**TypeORM:**

```bash
npm run migration:run  # or your migration command
```

**Raw SQL:**
Run the SQL migration manually:

```sql
ALTER TABLE users ADD COLUMN password VARCHAR(255);
```

**Note:** The exact migration command depends on your database setup. Ensure the `password` column is added to your users table before testing authentication.

## Configuration

### Environment Variables

Set the following environment variable in `.env.local`:

```bash
AUTH_SECRET=your-secret-key-here-minimum-32-characters
```

**Security Note:** Use a strong, random secret key. Generate one with:

```bash
openssl rand -base64 32
```

**Important:** NextAuth v5 requires `AUTH_SECRET` (not `NEXTAUTH_SECRET`).

### Intent Configuration Options

The `config` object in the intent supports:

- `secret`: Auth secret (can use `env:AUTH_SECRET` format)
- `expiration_hours`: Session expiration in hours (default: 24)
- `refresh_expiration_hours`: Not used with JWT strategy (JWT tokens are stateless)

## Testing

### Register a User

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "name": "John Doe"
  }'
```

### Login

Use the custom login endpoint:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }' \
  -c cookies.txt
```

This will:

- Validate credentials
- Create a NextAuth session (sets session cookie)
- Return user data

**Note:** The session cookie is automatically set in the response. Save cookies with `-c cookies.txt` for subsequent requests.

### Alternative: NextAuth Sign-In Page

NextAuth also provides a built-in sign-in page. In a browser, navigate to:

```
http://localhost:3000/api/auth/signin
```

For API testing with the built-in endpoint, you'll need to handle cookies:

```bash
# Sign in and save cookies
curl -X POST http://localhost:3000/api/auth/callback/credentials \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }' \
  -c cookies.txt

# Use cookies for protected endpoints
curl -X GET http://localhost:3000/api/posts \
  -b cookies.txt
```

### Get Current Session

```bash
curl -X GET http://localhost:3000/api/auth/session \
  -b cookies.txt
```

### Access Protected Endpoint

```bash
curl -X GET http://localhost:3000/api/posts \
  -b cookies.txt
```

Without authentication, you'll receive:

```json
{
  "success": false,
  "error": "Unauthorized"
}
```

## Security Best Practices

1. **Password Requirements**: Enforce minimum password length (8+ characters) in registration endpoint
2. **HTTPS**: Always use HTTPS in production
3. **Session Storage**: JWT tokens are stored in httpOnly cookies (secure by default)
4. **Token Expiration**: Use short-lived sessions (24 hours) for better security
5. **Secret Management**: Never commit `AUTH_SECRET` to version control
6. **Password Hashing**: Always use bcrypt with appropriate cost (10 rounds is standard)
7. **Rate Limiting**: Implement rate limiting on login/register endpoints
8. **CORS**: Configure CORS properly for your frontend domain
9. **CSRF Protection**: NextAuth includes CSRF protection by default

## Troubleshooting

### "AUTH_SECRET is required" error

- Ensure `AUTH_SECRET` environment variable is set in `.env.local`
- Restart the Next.js dev server after adding the variable

### "Cannot find module 'bcryptjs'" error

- Run `npm install bcryptjs @types/bcryptjs`
- Ensure `@types/bcryptjs` is in `devDependencies`

### "password field does not exist" error

- Ensure the database migration has been applied (adds the `password` column to users table)
- If using Prisma: Run `npx prisma generate` to regenerate Prisma client
- If using TypeORM/Drizzle: Regenerate your ORM types/schema
- Verify the column exists in your database: `SELECT * FROM users LIMIT 1;`

### "Unauthorized" on all API routes

- Check that middleware is correctly configured
- Verify session is being set (check cookies in browser DevTools)
- Ensure `auth()` function is exported from `auth.ts`

### Middleware not protecting routes / API requests allowed without authentication

**Troubleshooting Steps:**

1. **Restart Next.js dev server** - **MOST COMMON FIX**: After creating or modifying `middleware.ts`, restart your dev server (`npm run dev` or `pnpm dev`)
2. **Verify matcher pattern**: Ensure it uses regex syntax: `/api/(.*)` (NOT route syntax like `/api/:path*`)
3. **Check file location**: Verify `middleware.ts` is in the project root (same level as `package.json`, NOT in `app/` directory)
4. **Verify AUTH_SECRET**: Ensure `AUTH_SECRET` environment variable is set in `.env.local`
5. **Check middleware logic**: Verify the middleware function is checking `!req.auth` (NOT `!isLoggedIn` or `!!req.auth`)
6. **Test authentication**:
   - Test with a browser (which handles cookies automatically) rather than Postman
   - NextAuth uses httpOnly cookies for session management
   - Check browser DevTools → Application → Cookies to verify session cookie is set
7. **Verify public routes**: Ensure `/api/auth` is in the `publicRoutes` array
8. **Check Next.js version**: Ensure you're using Next.js 13+ with App Router
9. **Verify auth export**: Ensure `auth` is exported from `auth.ts` correctly

### Session not persisting

- Check that cookies are enabled in browser
- Verify `AUTH_SECRET` is set correctly
- Check browser console for cookie-related errors

## Next Steps

After implementing auth:

1. Add role-based access control (RBAC) if needed
2. Implement password reset functionality
3. Add email verification
4. Create sign-in/sign-up UI pages
5. Add social authentication providers (OAuth)
6. Implement session refresh mechanism
7. Add rate limiting to auth endpoints

## Differences from Gin Capability

- **Session Management**: NextAuth uses cookies instead of Authorization headers
- **Middleware**: Next.js middleware runs at the edge, not per-route
- **Type Safety**: Strong TypeScript integration with type declarations
- **Provider System**: NextAuth supports multiple providers (Credentials, OAuth, etc.)
- **No Manual Token Management**: NextAuth handles token generation and validation automatically
