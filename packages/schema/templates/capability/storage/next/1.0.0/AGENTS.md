# Supabase Storage Capability Implementation Guide

> **Template Version:** 1.0.0  
> **Compatible OIML Versions:** 0.1.x  
> **Compatible Next.js Versions:** 14.x.x, 15.x.x, 16.x.x  
> **Compatible Supabase JS Versions:** 2.x.x  
> **Last Updated:** 2025-11-18

This guide provides complete implementation instructions for adding storage capabilities to Next.js applications using [Supabase Storage](https://supabase.com/docs/guides/storage) with the `add_capability` intent.

## When to Use This Guide

Use this guide when:

- `api.framework` in `project.yaml` is set to `"next"`
- An `add_capability` intent with `capability: "storage"` and `framework: "next"` is being applied
- You need to implement file storage functionality using Supabase Storage

## Prerequisites

- Node.js 18+ is installed
- Next.js 14+ is installed
- A Supabase project ([Create one at supabase.com](https://supabase.com))
- Supabase project URL and API keys

## Overview

The storage capability implements:

- **Supabase Storage SDK** for reliable file storage
- **File uploads** (standard and resumable with TUS protocol)
- **File downloads** and serving with global CDN
- **Image transformations** (resize, compress, format conversion)
- **Public and private buckets** with Row Level Security (RLS)
- **Type-safe storage functions** with TypeScript
- **API endpoints** for file operations
- **Access control** with Supabase authentication
- **S3-compatible API** for advanced use cases

## Intent Structure and IR Transformation

### Human-Authored YAML Intent

The developer writes this simplified YAML intent:

```yaml
intents:
  - kind: add_capability
    scope: capability
    capability: storage
    framework: next
    provider: supabase
    config:
      supabase_url: env:NEXT_PUBLIC_SUPABASE_URL
      supabase_anon_key: env:NEXT_PUBLIC_SUPABASE_ANON_KEY
      supabase_service_role_key: env:SUPABASE_SERVICE_ROLE_KEY
    buckets:
      - name: avatars
        public: true
        file_size_limit: 5242880 # 5MB
        allowed_mime_types:
          - image/png
          - image/jpeg
          - image/webp
    endpoints:
      - method: POST
        path: /api/storage/upload
        description: Upload a file to storage
      - method: GET
        path: /api/storage/download/[id]
        description: Download a file from storage
      - method: DELETE
        path: /api/storage/delete/[id]
        description: Delete a file from storage
      - method: GET
        path: /api/storage/list
        description: List files in a bucket
```

### IR Transformation with Storage Overlay

**IMPORTANT:** The human-authored YAML intent is validated and transformed into an Intermediate Representation (IR) before code generation. The IR includes a strongly-typed `StorageCapabilityOverlay` that provides structured configuration for storage-specific features.

After transformation, the intent becomes:

```typescript
{
  kind: "AddCapability",
  irVersion: "1.0.0",
  provenance: { /* tracking info */ },
  capability: {
    type: "storage",
    framework: "next",
    provider: "supabase",
    config: {
      supabase_url: "env:NEXT_PUBLIC_SUPABASE_URL",
      supabase_anon_key: "env:NEXT_PUBLIC_SUPABASE_ANON_KEY",
      supabase_service_role_key: "env:SUPABASE_SERVICE_ROLE_KEY"
    },
    endpoints: [
      { method: "POST", path: "/api/storage/upload", description: "Upload a file to storage" },
      { method: "GET", path: "/api/storage/download/[id]", description: "Download a file from storage" },
      { method: "DELETE", path: "/api/storage/delete/[id]", description: "Delete a file from storage" },
      { method: "GET", path: "/api/storage/list", description: "List files in a bucket" }
    ],
    overlay: {
      type: "storage",
      // Bucket configurations with full type safety
      buckets: [
        {
          name: "avatars",
          public: true,
          fileSizeLimit: 5242880,  // 5MB in bytes
          allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
          cacheControl: "3600"
        }
      ],
      // Optional: Image transformation settings
      imageTransformations: {
        enabled: true,
        formats: ["webp", "avif", "jpeg", "png"],
        quality: {
          default: 80,
          min: 50,
          max: 100
        }
      },
      // Optional: CDN configuration
      cdn: {
        enabled: true,
        customDomain: "cdn.yourdomain.com"
      }
    }
  },
  diagnostics: []
}
```

### Storage Overlay Schema

The `StorageCapabilityOverlay` IR provides:

- **Type Safety**: Strongly-typed bucket and file configurations
- **Bucket Management**: Structured bucket definitions with access control
- **Image Transformations**: Configuration for on-the-fly image processing
- **CDN Settings**: Custom domain and CDN configuration
- **File Validation**: MIME type and size limit enforcement

### Configuration Options

The `config` object supports:

- `supabase_url`: Your Supabase project URL (use `env:NEXT_PUBLIC_SUPABASE_URL` format)
- `supabase_anon_key`: Your Supabase anonymous key for client-side operations
- `supabase_service_role_key`: Your Supabase service role key for server-side admin operations (optional)

### Bucket Configuration

Each bucket in the overlay can specify:

- `name`: Bucket name (required)
- `public`: Whether files are publicly accessible (default: false)
- `fileSizeLimit`: Maximum file size in bytes (optional)
- `allowedMimeTypes`: Allowed MIME types (optional)
- `cacheControl`: Cache-Control header value (optional)

### Endpoint Options

You can customize which endpoints to create:

- **`/api/storage/upload`**: File upload endpoint
- **`/api/storage/download/[id]`**: File download endpoint
- **`/api/storage/delete/[id]`**: File deletion endpoint
- **`/api/storage/list`**: List files endpoint

### IR-Driven Code Generation

**Code generation uses the IR overlay, not the raw YAML.** This ensures:

1. **Validation**: All bucket and file configurations are validated before code generation
2. **Type Safety**: The overlay schema enforces correct data types for file operations
3. **Consistency**: The IR provides a stable format across different intent versions
4. **Extensibility**: New overlay fields (e.g., image transformation options) can be added without breaking existing code
5. **Provider Abstraction**: The overlay structure can support multiple storage providers (Supabase, AWS S3, GCS) with the same interface

## Implementation Steps

**Important:** Before creating any files, check if they already exist. The following steps will create:

- `lib/storage.ts` - Supabase Storage client and utilities
- `app/api/storage/upload/route.ts` - File upload endpoint
- `app/api/storage/download/[id]/route.ts` - File download endpoint
- `app/api/storage/delete/[id]/route.ts` - File deletion endpoint
- `app/api/storage/list/route.ts` - List files endpoint
- `types/storage.ts` - Type definitions for storage operations

If any of these files already exist, review them and update as needed rather than overwriting.

### Step 1: Install Dependencies

Install the Supabase JavaScript client:

```bash
npm install @supabase/supabase-js
```

Or with pnpm:

```bash
pnpm add @supabase/supabase-js
```

**Optional but Recommended:** For resumable uploads with large files:

```bash
npm install @uppy/core @uppy/tus
```

Or with pnpm:

```bash
pnpm add @uppy/core @uppy/tus
```

### Step 2: Configure Environment Variables

Add your Supabase credentials to `.env.local`:

```bash
# Public keys (safe to expose in browser)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Service role key (server-side only, never expose to browser)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Security Notes:**

- Never commit service role keys to version control
- Use different projects for development and production
- Get your credentials from [Supabase Dashboard → Settings → API](https://supabase.com/dashboard/project/_/settings/api)

### Step 3: Create Supabase Storage Client and Utilities

**File location:** `lib/storage.ts` (based on `paths.utils` from `project.yaml`, defaults to `lib/`)

Create `lib/storage.ts`:

````typescript
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client for client-side operations
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Initialize Supabase admin client for server-side operations (optional)
export const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

/**
 * Storage utility interfaces
 */
export interface UploadFileOptions {
  bucket: string;
  path: string;
  file: File | Blob;
  contentType?: string;
  cacheControl?: string;
  upsert?: boolean;
}

export interface DownloadFileOptions {
  bucket: string;
  path: string;
}

export interface DeleteFileOptions {
  bucket: string;
  paths: string[];
}

export interface ListFilesOptions {
  bucket: string;
  path?: string;
  limit?: number;
  offset?: number;
  sortBy?: {
    column: "name" | "created_at" | "updated_at";
    order: "asc" | "desc";
  };
}

export interface GetPublicUrlOptions {
  bucket: string;
  path: string;
  download?: boolean;
  transform?: {
    width?: number;
    height?: number;
    resize?: "cover" | "contain" | "fill";
    quality?: number;
    format?: "origin" | "webp" | "avif";
  };
}

/**
 * Upload a file to Supabase Storage
 *
 * @param options - Upload options
 * @returns Promise with file path and public URL (if public bucket)
 *
 * @example
 * ```typescript
 * const file = event.target.files[0];
 * const result = await uploadFile({
 *   bucket: "avatars",
 *   path: `${userId}/${file.name}`,
 *   file: file
 * });
 * ```
 */
export async function uploadFile(options: UploadFileOptions) {
  const { bucket, path, file, contentType, cacheControl = "3600", upsert = false } = options;

  try {
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
      contentType,
      cacheControl,
      upsert
    });

    if (error) {
      console.error("Supabase upload error:", error);
      throw new Error(error.message || "Failed to upload file");
    }

    // Get public URL if bucket is public
    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);

    return {
      success: true,
      path: data.path,
      publicUrl: urlData.publicUrl,
      message: "File uploaded successfully"
    };
  } catch (error) {
    console.error("Error uploading file:", error);
    throw error;
  }
}

/**
 * Download a file from Supabase Storage
 *
 * @param options - Download options
 * @returns Promise with file blob
 *
 * @example
 * ```typescript
 * const blob = await downloadFile({
 *   bucket: "documents",
 *   path: "reports/annual-2024.pdf"
 * });
 * ```
 */
export async function downloadFile(options: DownloadFileOptions) {
  const { bucket, path } = options;

  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);

    if (error) {
      console.error("Supabase download error:", error);
      throw new Error(error.message || "Failed to download file");
    }

    return {
      success: true,
      blob: data,
      message: "File downloaded successfully"
    };
  } catch (error) {
    console.error("Error downloading file:", error);
    throw error;
  }
}

/**
 * Delete file(s) from Supabase Storage
 *
 * @param options - Delete options
 * @returns Promise with deletion result
 *
 * @example
 * ```typescript
 * await deleteFiles({
 *   bucket: "avatars",
 *   paths: ["user123/avatar.png"]
 * });
 * ```
 */
export async function deleteFiles(options: DeleteFileOptions) {
  const { bucket, paths } = options;

  try {
    const { data, error } = await supabase.storage.from(bucket).remove(paths);

    if (error) {
      console.error("Supabase delete error:", error);
      throw new Error(error.message || "Failed to delete files");
    }

    return {
      success: true,
      deletedFiles: data,
      message: `Successfully deleted ${paths.length} file(s)`
    };
  } catch (error) {
    console.error("Error deleting files:", error);
    throw error;
  }
}

/**
 * List files in a bucket
 *
 * @param options - List options
 * @returns Promise with file list
 *
 * @example
 * ```typescript
 * const files = await listFiles({
 *   bucket: "documents",
 *   path: "reports",
 *   limit: 50,
 *   sortBy: { column: "created_at", order: "desc" }
 * });
 * ```
 */
export async function listFiles(options: ListFilesOptions) {
  const { bucket, path = "", limit = 100, offset = 0, sortBy } = options;

  try {
    const { data, error } = await supabase.storage.from(bucket).list(path, {
      limit,
      offset,
      sortBy: sortBy ? { column: sortBy.column, order: sortBy.order } : undefined
    });

    if (error) {
      console.error("Supabase list error:", error);
      throw new Error(error.message || "Failed to list files");
    }

    return {
      success: true,
      files: data,
      message: "Files listed successfully"
    };
  } catch (error) {
    console.error("Error listing files:", error);
    throw error;
  }
}

/**
 * Get public URL for a file (works for public buckets only)
 *
 * @param options - Public URL options
 * @returns Public URL with optional transformations
 *
 * @example
 * ```typescript
 * const url = getPublicUrl({
 *   bucket: "avatars",
 *   path: "user123/avatar.jpg",
 *   transform: {
 *     width: 200,
 *     height: 200,
 *     resize: "cover",
 *     quality: 80
 *   }
 * });
 * ```
 */
export function getPublicUrl(options: GetPublicUrlOptions): string {
  const { bucket, path, download, transform } = options;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path, {
    download,
    transform
  });

  return data.publicUrl;
}

/**
 * Get signed URL for private files (temporary access)
 *
 * @param bucket - Bucket name
 * @param path - File path
 * @param expiresIn - Expiration time in seconds (default: 60)
 * @returns Promise with signed URL
 *
 * @example
 * ```typescript
 * const url = await getSignedUrl("documents", "private/report.pdf", 3600);
 * // URL expires in 1 hour
 * ```
 */
export async function getSignedUrl(bucket: string, path: string, expiresIn: number = 60): Promise<string> {
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);

    if (error) {
      console.error("Supabase signed URL error:", error);
      throw new Error(error.message || "Failed to create signed URL");
    }

    return data.signedUrl;
  } catch (error) {
    console.error("Error creating signed URL:", error);
    throw error;
  }
}

/**
 * Create a storage bucket
 *
 * @param name - Bucket name
 * @param options - Bucket options
 * @returns Promise with creation result
 *
 * Note: Requires service role key (admin client)
 */
export async function createBucket(
  name: string,
  options: {
    public?: boolean;
    fileSizeLimit?: number;
    allowedMimeTypes?: string[];
  } = {}
) {
  if (!supabaseAdmin) {
    throw new Error("Service role key required for bucket creation");
  }

  try {
    const { data, error } = await supabaseAdmin.storage.createBucket(name, {
      public: options.public ?? false,
      fileSizeLimit: options.fileSizeLimit,
      allowedMimeTypes: options.allowedMimeTypes
    });

    if (error) {
      console.error("Supabase create bucket error:", error);
      throw new Error(error.message || "Failed to create bucket");
    }

    return {
      success: true,
      bucket: data,
      message: `Bucket "${name}" created successfully`
    };
  } catch (error) {
    console.error("Error creating bucket:", error);
    throw error;
  }
}

/**
 * Helper function to validate file type
 */
export function validateFileType(file: File, allowedTypes: string[]): boolean {
  return allowedTypes.includes(file.type);
}

/**
 * Helper function to validate file size
 */
export function validateFileSize(file: File, maxSize: number): boolean {
  return file.size <= maxSize;
}

/**
 * Helper function to generate unique file path
 */
export function generateFilePath(userId: string, originalName: string, folder?: string): string {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const extension = originalName.split(".").pop();
  const filename = `${timestamp}-${randomString}.${extension}`;

  return folder ? `${userId}/${folder}/${filename}` : `${userId}/${filename}`;
}
````

**Key Features:**

- **Supabase client initialization** with environment variables
- **Type-safe storage functions** with TypeScript interfaces
- **uploadFile function** for uploading files with automatic public URL generation
- **downloadFile function** for retrieving files as blobs
- **deleteFiles function** for removing single or multiple files
- **listFiles function** with sorting and pagination
- **getPublicUrl function** with image transformation support
- **getSignedUrl function** for temporary access to private files
- **createBucket function** for programmatic bucket creation (admin only)
- **Helper functions** for validation and file path generation

**TypeScript Notes:**

- All functions use proper TypeScript interfaces to avoid `any` types
- Supabase SDK provides built-in type safety
- Error handling follows consistent patterns

### Step 4: Create File Upload API Endpoint

**CRITICAL:** Check if the route already exists before creating. Verify if `app/api/storage/upload/route.ts` exists.

**File location:** `app/api/storage/upload/route.ts` (based on `paths.api: app/api` from `project.yaml`)

Create `app/api/storage/upload/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { uploadFile, validateFileType, validateFileSize, generateFilePath } from "@/lib/storage";

/**
 * POST /api/storage/upload
 *
 * Upload a file to Supabase Storage
 *
 * Request body (multipart/form-data):
 * - file: File to upload (required)
 * - bucket: Bucket name (required)
 * - folder: Optional folder path
 * - userId: User ID for organizing files (optional)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     path: string,
 *     publicUrl: string,
 *     message: string
 *   }
 * }
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const bucket = formData.get("bucket") as string;
    const folder = formData.get("folder") as string | null;
    const userId = formData.get("userId") as string | null;

    // Validation
    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: "No file provided"
        },
        { status: 400 }
      );
    }

    if (!bucket) {
      return NextResponse.json(
        {
          success: false,
          error: "Bucket name is required"
        },
        { status: 400 }
      );
    }

    // Optional: Validate file type and size based on bucket configuration
    // This should match the bucket configuration from the intent
    const bucketConfig: Record<string, { maxSize: number; allowedTypes: string[] }> = {
      avatars: {
        maxSize: 5 * 1024 * 1024, // 5MB
        allowedTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"]
      },
      documents: {
        maxSize: 50 * 1024 * 1024, // 50MB
        allowedTypes: [
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "text/plain"
        ]
      }
    };

    const config = bucketConfig[bucket];
    if (config) {
      if (!validateFileType(file, config.allowedTypes)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid file type. Allowed types: ${config.allowedTypes.join(", ")}`
          },
          { status: 400 }
        );
      }

      if (!validateFileSize(file, config.maxSize)) {
        return NextResponse.json(
          {
            success: false,
            error: `File too large. Maximum size: ${config.maxSize / (1024 * 1024)}MB`
          },
          { status: 400 }
        );
      }
    }

    // Generate unique file path
    const filePath = userId
      ? generateFilePath(userId, file.name, folder || undefined)
      : `${folder ? folder + "/" : ""}${Date.now()}-${file.name}`;

    // Upload file to Supabase Storage
    const result = await uploadFile({
      bucket,
      path: filePath,
      file,
      contentType: file.type
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          path: result.path,
          publicUrl: result.publicUrl,
          message: result.message
        }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in upload endpoint:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to upload file"
      },
      { status: 500 }
    );
  }
}
```

**Endpoint Features:**

- **Multipart form data** support for file uploads
- **File validation** (type and size) based on bucket configuration
- **Unique file path generation** to prevent conflicts
- **Error handling** with appropriate HTTP status codes
- **Flexible organization** with optional userId and folder paths

### Step 5: Create File Download API Endpoint (Optional)

**CRITICAL:** Only create this endpoint if specified in the intent's `endpoints` array.

**File location:** `app/api/storage/download/[id]/route.ts`

Create `app/api/storage/download/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { downloadFile } from "@/lib/storage";

/**
 * GET /api/storage/download/[id]
 *
 * Download a file from Supabase Storage
 *
 * Query parameters:
 * - bucket: Bucket name (required)
 * - path: File path (required)
 *
 * Response: File blob with appropriate content type
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(request.url);
    const bucket = searchParams.get("bucket");
    const path = searchParams.get("path");

    if (!bucket || !path) {
      return NextResponse.json(
        {
          success: false,
          error: "Bucket and path are required"
        },
        { status: 400 }
      );
    }

    // Download file from Supabase Storage
    const result = await downloadFile({ bucket, path });

    // Return file blob with appropriate headers
    return new NextResponse(result.blob, {
      status: 200,
      headers: {
        "Content-Type": result.blob.type,
        "Content-Disposition": `attachment; filename="${path.split("/").pop()}"`
      }
    });
  } catch (error) {
    console.error("Error in download endpoint:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to download file"
      },
      { status: 500 }
    );
  }
}
```

### Step 6: Create File Deletion API Endpoint (Optional)

**CRITICAL:** Only create this endpoint if specified in the intent's `endpoints` array.

**File location:** `app/api/storage/delete/[id]/route.ts`

Create `app/api/storage/delete/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { deleteFiles } from "@/lib/storage";

/**
 * DELETE /api/storage/delete/[id]
 *
 * Delete file(s) from Supabase Storage
 *
 * Request body:
 * {
 *   bucket: string,
 *   paths: string[]
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     deletedFiles: FileObject[],
 *     message: string
 *   }
 * }
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { bucket, paths } = body;

    // Validation
    if (!bucket) {
      return NextResponse.json(
        {
          success: false,
          error: "Bucket name is required"
        },
        { status: 400 }
      );
    }

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Paths array is required and must not be empty"
        },
        { status: 400 }
      );
    }

    // Delete files from Supabase Storage
    const result = await deleteFiles({ bucket, paths });

    return NextResponse.json(
      {
        success: true,
        data: {
          deletedFiles: result.deletedFiles,
          message: result.message
        }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in delete endpoint:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete files"
      },
      { status: 500 }
    );
  }
}
```

### Step 7: Create List Files API Endpoint (Optional)

**CRITICAL:** Only create this endpoint if specified in the intent's `endpoints` array.

**File location:** `app/api/storage/list/route.ts`

Create `app/api/storage/list/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { listFiles } from "@/lib/storage";

/**
 * GET /api/storage/list
 *
 * List files in a bucket
 *
 * Query parameters:
 * - bucket: Bucket name (required)
 * - path: Path prefix to filter by (optional)
 * - limit: Maximum number of files to return (optional, default: 100)
 * - offset: Number of files to skip (optional, default: 0)
 * - sortBy: Sort column (name, created_at, updated_at) (optional)
 * - sortOrder: Sort order (asc, desc) (optional)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     files: FileObject[],
 *     message: string
 *   }
 * }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const bucket = searchParams.get("bucket");
    const path = searchParams.get("path") || "";
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");
    const sortBy = searchParams.get("sortBy") as "name" | "created_at" | "updated_at" | null;
    const sortOrder = searchParams.get("sortOrder") as "asc" | "desc" | null;

    if (!bucket) {
      return NextResponse.json(
        {
          success: false,
          error: "Bucket name is required"
        },
        { status: 400 }
      );
    }

    // List files from Supabase Storage
    const result = await listFiles({
      bucket,
      path,
      limit,
      offset,
      sortBy: sortBy && sortOrder ? { column: sortBy, order: sortOrder } : undefined
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          files: result.files,
          message: result.message
        }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in list endpoint:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list files"
      },
      { status: 500 }
    );
  }
}
```

### Step 8: Create Type Definitions

**File location:** `types/storage.ts` (based on `paths.types` from `project.yaml`)

Create `types/storage.ts`:

```typescript
/**
 * Storage-related type definitions
 */

export interface FileUploadRequest {
  bucket: string;
  folder?: string;
  userId?: string;
}

export interface FileUploadResponse {
  success: boolean;
  data?: {
    path: string;
    publicUrl: string;
    message: string;
  };
  error?: string;
}

export interface FileDownloadRequest {
  bucket: string;
  path: string;
}

export interface FileDeleteRequest {
  bucket: string;
  paths: string[];
}

export interface FileDeleteResponse {
  success: boolean;
  data?: {
    deletedFiles: FileObject[];
    message: string;
  };
  error?: string;
}

export interface FileListRequest {
  bucket: string;
  path?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface FileListResponse {
  success: boolean;
  data?: {
    files: FileObject[];
    message: string;
  };
  error?: string;
}

export interface FileObject {
  id: string;
  name: string;
  bucket_id: string;
  owner?: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
  metadata: FileMetadata;
}

export interface FileMetadata {
  eTag: string;
  size: number;
  mimetype: string;
  cacheControl: string;
  lastModified: string;
  contentLength: number;
  httpStatusCode: number;
}

export interface ImageTransformOptions {
  width?: number;
  height?: number;
  resize?: "cover" | "contain" | "fill";
  quality?: number;
  format?: "origin" | "webp" | "avif";
}

export interface BucketConfig {
  name: string;
  public: boolean;
  fileSizeLimit?: number;
  allowedMimeTypes?: string[];
}

/**
 * Common MIME types for validation
 */
export const MIME_TYPES = {
  // Images
  PNG: "image/png",
  JPEG: "image/jpeg",
  JPG: "image/jpg",
  GIF: "image/gif",
  WEBP: "image/webp",
  SVG: "image/svg+xml",

  // Documents
  PDF: "application/pdf",
  DOC: "application/msword",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  XLS: "application/vnd.ms-excel",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  PPT: "application/vnd.ms-powerpoint",
  PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  TXT: "text/plain",

  // Archives
  ZIP: "application/zip",
  RAR: "application/x-rar-compressed",

  // Video
  MP4: "video/mp4",
  WEBM: "video/webm",
  MOV: "video/quicktime",

  // Audio
  MP3: "audio/mpeg",
  WAV: "audio/wav",
  OGG: "audio/ogg"
} as const;

/**
 * File size limits (in bytes)
 */
export const FILE_SIZE_LIMITS = {
  AVATAR: 5 * 1024 * 1024, // 5MB
  IMAGE: 10 * 1024 * 1024, // 10MB
  DOCUMENT: 50 * 1024 * 1024, // 50MB
  VIDEO: 500 * 1024 * 1024, // 500MB
  MAX: 1024 * 1024 * 1024 // 1GB
} as const;
```

## Configuration

### Environment Variables

Set the following environment variables in `.env.local`:

```bash
# Required - Public variables (safe to expose in browser)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Optional - Service role key (server-side only, NEVER expose to browser)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Getting Your Credentials:**

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to Settings → API
4. Copy your Project URL and anon/public key
5. (Optional) Copy service_role key for admin operations

**Security Notes:**

- `NEXT_PUBLIC_*` variables are exposed to the browser
- Never expose service_role key in client-side code
- Service role key bypasses Row Level Security (RLS)
- Use service role key only for admin operations on the server

### Supabase Storage Setup

#### 1. Create Storage Buckets

In Supabase Dashboard:

1. Go to Storage
2. Click "New bucket"
3. Enter bucket name (e.g., "avatars", "documents")
4. Choose "Public" or "Private"
5. (Optional) Set file size limit
6. (Optional) Set allowed MIME types

Or use the API:

```typescript
import { createBucket } from "@/lib/storage";

// Create a public bucket for avatars
await createBucket("avatars", {
  public: true,
  fileSizeLimit: 5 * 1024 * 1024, // 5MB
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"]
});

// Create a private bucket for documents
await createBucket("documents", {
  public: false,
  fileSizeLimit: 50 * 1024 * 1024 // 50MB
});
```

#### 2. Configure Row Level Security (RLS)

For private buckets, set up RLS policies:

```sql
-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to view their own files
CREATE POLICY "Users can view own files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to delete their own files
CREATE POLICY "Users can delete own files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

#### 3. Configure CORS (if needed)

If uploading from a different domain, configure CORS in Supabase Dashboard:

1. Go to Settings → API
2. Scroll to "CORS Configuration"
3. Add your allowed origins

## Usage Examples

### Upload a File

**Client-side (React component):**

```typescript
"use client";

import { useState } from "react";

export default function FileUpload() {
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("bucket", "avatars");
      formData.append("userId", "user123"); // Replace with actual user ID

      const response = await fetch("/api/storage/upload", {
        method: "POST",
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        setUrl(result.data.publicUrl);
        alert("File uploaded successfully!");
      } else {
        alert("Upload failed: " + result.error);
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <input
        type="file"
        onChange={handleUpload}
        disabled={uploading}
        accept="image/*"
      />
      {uploading && <p>Uploading...</p>}
      {url && <img src={url} alt="Uploaded" width={200} />}
    </div>
  );
}
```

**Server-side (direct upload):**

```typescript
import { uploadFile } from "@/lib/storage";

// In a server component or API route
const file = new File([buffer], "document.pdf", { type: "application/pdf" });

const result = await uploadFile({
  bucket: "documents",
  path: `reports/${userId}/report-2024.pdf`,
  file,
  contentType: "application/pdf"
});

console.log("File uploaded:", result.publicUrl);
```

### Download a File

```typescript
// Download file as blob
const response = await fetch(`/api/storage/download/123?bucket=documents&path=reports/annual-2024.pdf`);
const blob = await response.blob();

// Create download link
const url = URL.createObjectURL(blob);
const link = document.createElement("a");
link.href = url;
link.download = "annual-2024.pdf";
link.click();
URL.revokeObjectURL(url);
```

### List Files

```typescript
const response = await fetch(
  `/api/storage/list?bucket=documents&path=reports&limit=50&sortBy=created_at&sortOrder=desc`
);
const result = await response.json();

if (result.success) {
  result.data.files.forEach(file => {
    console.log(`${file.name} - ${file.metadata.size} bytes`);
  });
}
```

### Delete Files

```typescript
const response = await fetch("/api/storage/delete/123", {
  method: "DELETE",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    bucket: "documents",
    paths: ["reports/old-report.pdf", "reports/draft.pdf"]
  })
});

const result = await response.json();
console.log(result.data.message); // "Successfully deleted 2 file(s)"
```

### Image Transformations

**Get transformed image URL:**

```typescript
import { getPublicUrl } from "@/lib/storage";

// Resize image to 400x400, cover mode, 80% quality, WebP format
const url = getPublicUrl({
  bucket: "avatars",
  path: "user123/profile.jpg",
  transform: {
    width: 400,
    height: 400,
    resize: "cover",
    quality: 80,
    format: "webp"
  }
});

// Use in Image component
<img src={url} alt="Profile" />
```

### Signed URLs for Private Files

```typescript
import { getSignedUrl } from "@/lib/storage";

// Create a signed URL that expires in 1 hour
const signedUrl = await getSignedUrl(
  "documents",
  "private/confidential-report.pdf",
  3600 // 1 hour
);

// Share this URL - it will expire after 1 hour
console.log("Temporary URL:", signedUrl);
```

### Resumable Uploads with Uppy (for large files)

**Client-side component:**

```typescript
"use client";

import { useEffect } from "react";
import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import { Dashboard } from "@uppy/react";
import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";

export default function ResumableUpload() {
  const uppy = new Uppy({
    restrictions: {
      maxFileSize: 100 * 1024 * 1024, // 100MB
      allowedFileTypes: ["video/*"]
    }
  }).use(Tus, {
    endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
    headers: {
      authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      "x-upsert": "true"
    },
    chunkSize: 6 * 1024 * 1024, // 6MB chunks
    allowedMetaFields: ["bucketName", "objectName", "contentType", "cacheControl"]
  });

  uppy.on("file-added", (file) => {
    file.meta = {
      ...file.meta,
      bucketName: "videos",
      objectName: `uploads/${file.name}`,
      contentType: file.type
    };
  });

  uppy.on("complete", (result) => {
    console.log("Upload complete:", result);
  });

  return <Dashboard uppy={uppy} />;
}
```

## Testing

### Test File Upload

```bash
curl -X POST http://localhost:3000/api/storage/upload \
  -F "file=@/path/to/image.jpg" \
  -F "bucket=avatars" \
  -F "userId=user123"
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "path": "user123/1699999999-abc123.jpg",
    "publicUrl": "https://your-project.supabase.co/storage/v1/object/public/avatars/user123/1699999999-abc123.jpg",
    "message": "File uploaded successfully"
  }
}
```

### Test File List

```bash
curl "http://localhost:3000/api/storage/list?bucket=avatars&path=user123&limit=10&sortBy=created_at&sortOrder=desc"
```

### Test File Deletion

```bash
curl -X DELETE http://localhost:3000/api/storage/delete/123 \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "avatars",
    "paths": ["user123/old-avatar.jpg"]
  }'
```

## Best Practices

1. **Use Public Buckets for Public Assets**: Images, logos, and public documents should use public buckets for better performance
2. **Use Private Buckets with RLS**: Sensitive files should use private buckets with Row Level Security policies
3. **Organize Files by User**: Use folder structure like `{userId}/{folder}/{filename}` for easy management
4. **Validate File Types**: Always validate MIME types on both client and server
5. **Limit File Sizes**: Set appropriate file size limits based on your use case
6. **Use Image Transformations**: Leverage Supabase's built-in image optimizer instead of pre-processing
7. **Clean Up Old Files**: Implement file cleanup for replaced files (e.g., old avatars)
8. **Use Signed URLs**: For private files, use signed URLs with appropriate expiration times
9. **Implement Progress Tracking**: For large files, use resumable uploads with progress indicators
10. **CDN Caching**: Configure cache-control headers appropriately for performance
11. **TypeScript Types**: Use the provided TypeScript interfaces for type safety

## Troubleshooting

### "Missing Supabase environment variables" error

- Ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in `.env.local`
- Restart Next.js dev server after adding variables
- Verify variables are accessible in browser console

### "Bucket not found" error

- Create the bucket in Supabase Dashboard → Storage
- Ensure bucket name matches exactly (case-sensitive)
- Check if bucket has been created successfully

### "Row Level Security policy violation" error

- Check RLS policies in Supabase Dashboard → Storage → Policies
- Ensure user is authenticated if policies require authentication
- Verify policy conditions match your use case
- Use service role key for admin operations (bypasses RLS)

### Files not uploading

- Check file size against bucket limits
- Verify MIME type is allowed
- Check browser console for errors
- Ensure CORS is configured correctly (if uploading from different domain)
- Verify Supabase project is not paused

### Images not transforming

- Image transformations only work on public buckets
- Verify image format is supported (JPEG, PNG, WebP, AVIF, GIF)
- Check transform parameters are valid
- Ensure file is actually an image

### Signed URLs not working

- Check URL hasn't expired
- Verify bucket exists and file path is correct
- Ensure file exists in storage
- Check if RLS policies are preventing access

## Security Considerations

1. **Never Expose Service Role Key**: Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only
2. **Implement RLS Policies**: Always use Row Level Security for private buckets
3. **Validate File Types**: Check MIME types to prevent malicious file uploads
4. **Limit File Sizes**: Prevent abuse with appropriate file size limits
5. **Scan Uploaded Files**: Consider virus scanning for user-uploaded files
6. **Use Signed URLs**: For private files, always use signed URLs with expiration
7. **Implement Rate Limiting**: Prevent abuse with upload rate limiting
8. **Sanitize Filenames**: Clean user-provided filenames to prevent path traversal
9. **Authentication**: Protect upload endpoints with authentication
10. **Audit Logging**: Log file operations for security audit trails

## Performance Optimization

1. **Use CDN**: Supabase Storage includes global CDN - leverage it
2. **Image Transformations**: Use on-the-fly transformations instead of storing multiple sizes
3. **Cache-Control Headers**: Set appropriate cache headers for static assets
4. **Lazy Loading**: Load images lazily in UI for better performance
5. **Compress Images**: Use WebP/AVIF format with appropriate quality settings
6. **Resumable Uploads**: Use TUS protocol for large file uploads
7. **Parallel Uploads**: Upload multiple small files in parallel
8. **Progressive Images**: Use progressive JPEG for better perceived performance

## Resources

- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
- [Supabase Storage API Reference](https://supabase.com/docs/reference/javascript/storage-from)
- [Supabase Storage CDN](https://supabase.com/docs/guides/storage/cdn/fundamentals)
- [Image Transformations](https://supabase.com/docs/guides/storage/serving/image-transformations)
- [Resumable Uploads with Uppy](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Storage Best Practices](https://supabase.com/docs/guides/storage)

## Differences from Email Capability

- **External Storage Service**: Uses Supabase Storage instead of local filesystem
- **CDN Integration**: Built-in global CDN for fast file delivery
- **Image Transformations**: On-the-fly image processing without pre-processing
- **RLS Security**: Fine-grained access control with Row Level Security
- **Resumable Uploads**: Native support for TUS protocol for large files
- **Public and Private Buckets**: Flexible visibility options for different use cases
- **S3 Compatibility**: S3-compatible API for advanced integrations
