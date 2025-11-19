import { NextResponse } from "next/server";
import { downloadFile } from "@/lib/storage";

/**
 * GET /api/storage/download/[id]
 *
 * Download a file from Supabase Storage
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Resolve params (Next.js 16+ passes params as a Promise)
  const resolvedParams = await params;

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
