import { NextResponse } from "next/server";
import { listFiles } from "@/lib/storage";

/**
 * GET /api/storage/list
 *
 * List files in a bucket
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
