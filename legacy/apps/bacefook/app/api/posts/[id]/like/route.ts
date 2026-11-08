import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { LikeResponse, ErrorResponse } from "@/packages/types";

// POST /api/posts/:id/like - Like a post
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const userId = ""; // Placeholder

    if (!userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Authentication required"
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    const resolvedParams = await params;

    // Check if post exists
    const post = await prisma.post.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!post) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Post not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Check if already liked
    const existingLike = await prisma.like.findUnique({
      where: {
        user_id_post_id: {
          user_id: userId,
          post_id: resolvedParams.id
        }
      }
    });

    if (existingLike) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Post already liked"
      };
      return NextResponse.json(errorResponse, { status: 409 });
    }

    const like = await prisma.like.create({
      data: {
        user_id: userId,
        post_id: resolvedParams.id
      }
    });

    const response: LikeResponse = {
      data: like
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error liking post:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to like post"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// DELETE /api/posts/:id/like - Unlike a post
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const userId = ""; // Placeholder

    if (!userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Authentication required"
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    const resolvedParams = await params;

    const existingLike = await prisma.like.findUnique({
      where: {
        user_id_post_id: {
          user_id: userId,
          post_id: resolvedParams.id
        }
      }
    });

    if (!existingLike) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Post not liked"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    await prisma.like.delete({
      where: {
        id: existingLike.id
      }
    });

    return NextResponse.json({ success: true, message: "Post unliked successfully" }, { status: 200 });
  } catch (error) {
    console.error("Error unliking post:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to unlike post"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
