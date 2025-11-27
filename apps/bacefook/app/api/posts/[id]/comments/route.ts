import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { CommentResponse, ErrorResponse } from '@/packages/types';

// POST /api/posts/:id/comments - Create a comment on a post
export async function POST(
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
    const { content, parent_comment_id } = body;

    if (!content) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Missing required field: content',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Check if post exists
    const post = await prisma.post.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!post) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Post not found',
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // If parent_comment_id is provided, verify it exists and belongs to the same post
    if (parent_comment_id) {
      const parentComment = await prisma.comment.findUnique({
        where: { id: parent_comment_id },
      });

      if (!parentComment || parentComment.post_id !== resolvedParams.id) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: 'Parent comment not found or does not belong to this post',
        };
        return NextResponse.json(errorResponse, { status: 404 });
      }
    }

    const comment = await prisma.comment.create({
      data: {
        user_id: userId,
        post_id: resolvedParams.id,
        content,
        parent_comment_id: parent_comment_id || null,
      },
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

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating comment:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create comment',
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// GET /api/posts/:id/comments - Get all comments for a post
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const resolvedParams = await params;

    const comments = await prisma.comment.findMany({
      where: {
        post_id: resolvedParams.id,
        parent_comment_id: null, // Only top-level comments
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
        replies: {
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
          orderBy: {
            created_at: 'asc',
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    const response: CommentResponse = {
      data: comments,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching comments:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch comments',
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
