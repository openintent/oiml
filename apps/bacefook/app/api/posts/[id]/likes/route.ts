import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { LikeResponse, ErrorResponse } from '@/packages/types';

// GET /api/posts/:id/likes - Get all likes for a post
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const resolvedParams = await params;

    const likes = await prisma.like.findMany({
      where: {
        post_id: resolvedParams.id,
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
      orderBy: {
        created_at: 'desc',
      },
    });

    const response: LikeResponse = {
      data: likes,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching likes:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch likes',
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
