import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { CommentResponse, ErrorResponse } from '@/packages/types';

// PUT /api/comments/:id - Update a comment (only by author)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const userId = ''; // Placeholder

    if (!userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Authentication required',
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    const resolvedParams = await params;
    const body = await request.json();
    const { content } = body;

    if (!content) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Missing required field: content',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Check if comment exists and user is the author
    const existingComment = await prisma.comment.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!existingComment) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Comment not found',
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    if (existingComment.user_id !== userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Unauthorized - only the author can update this comment',
      };
      return NextResponse.json(errorResponse, { status: 403 });
    }

    const comment = await prisma.comment.update({
      where: { id: resolvedParams.id },
      data: { content },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });

    const response: CommentResponse = {
      data: comment,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error updating comment:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update comment',
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// DELETE /api/comments/:id - Delete a comment (only by author)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const userId = ''; // Placeholder

    if (!userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Authentication required',
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    const resolvedParams = await params;

    // Check if comment exists and user is the author
    const existingComment = await prisma.comment.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!existingComment) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Comment not found',
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    if (existingComment.user_id !== userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Unauthorized - only the author can delete this comment',
      };
      return NextResponse.json(errorResponse, { status: 403 });
    }

    await prisma.comment.delete({
      where: { id: resolvedParams.id },
    });

    return NextResponse.json(
      { success: true, message: 'Comment deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting comment:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete comment',
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
