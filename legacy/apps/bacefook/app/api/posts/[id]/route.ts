import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PostResponse, ErrorResponse } from "@/packages/types";

// GET /api/posts/:id - Get a specific post by ID
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const resolvedParams = await params;

    const post = await prisma.post.findUnique({
      where: { id: resolvedParams.id },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true
          }
        },
        _count: {
          select: {
            likes: true,
            comments: true
          }
        }
      }
    });

    if (!post) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Post not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: PostResponse = {
      data: post
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching post:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch post"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// PUT /api/posts/:id - Update a post (only by author)
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const body = await request.json();
    const { content, visibility } = body;

    // Check if post exists and user is the author
    const existingPost = await prisma.post.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existingPost) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Post not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    if (existingPost.author_id !== userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Unauthorized - only the author can update this post"
      };
      return NextResponse.json(errorResponse, { status: 403 });
    }

    const updateData: any = {};
    if (content !== undefined) updateData.content = content;
    if (visibility !== undefined) updateData.visibility = visibility;

    const post = await prisma.post.update({
      where: { id: resolvedParams.id },
      data: updateData,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true
          }
        }
      }
    });

    const response: PostResponse = {
      data: post
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error updating post:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update post"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// DELETE /api/posts/:id - Delete a post (only by author)
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

    // Check if post exists and user is the author
    const existingPost = await prisma.post.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existingPost) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Post not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    if (existingPost.author_id !== userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Unauthorized - only the author can delete this post"
      };
      return NextResponse.json(errorResponse, { status: 403 });
    }

    await prisma.post.delete({
      where: { id: resolvedParams.id }
    });

    return NextResponse.json({ success: true, message: "Post deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting post:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete post"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
