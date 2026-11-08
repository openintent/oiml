import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PostResponse, ErrorResponse } from "@/packages/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const userId = parseInt(resolvedParams.id);

    if (isNaN(userId)) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Invalid user ID"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "User not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const posts = await prisma.post.findMany({
      where: { author_id: userId },
      orderBy: { created_at: "desc" }
    });

    const response: PostResponse = {
      data: posts
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching posts for user:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch posts"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
