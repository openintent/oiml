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
    format?: "origin";
  };
}

/**
 * Upload a file to Supabase Storage
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
