import { NextResponse } from "next/server";
import { uploadFile, validateFileType, validateFileSize, generateFilePath } from "@/lib/storage";

/**
 * POST /api/storage/upload
 *
 * Upload a file to Supabase Storage
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const bucket = (formData.get("bucket") as string) || "avatars";
    const folder = formData.get("folder") as string | null;
    const userId = (formData.get("userId") as string) || "anonymous";

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
    const bucketConfig: Record<string, { maxSize: number; allowedTypes: string[] }> = {
      uploads: {
        maxSize: 10 * 1024 * 1024, // 10MB
        allowedTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]
      },
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
