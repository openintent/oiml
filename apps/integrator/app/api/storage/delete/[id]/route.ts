import { NextResponse } from "next/server";
import { deleteFiles } from "@/lib/storage";

/**
 * DELETE /api/storage/delete/[id]
 *
 * Delete file(s) from Supabase Storage
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Resolve params (Next.js 16+ passes params as a Promise)
  const resolvedParams = await params;

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
