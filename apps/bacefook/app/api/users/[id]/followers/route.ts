import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { FollowResponse, ErrorResponse } from '@/packages/types';

// GET /api/users/:id/followers - Get user's followers
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const resolvedParams = await params;

    const followers = await prisma.follow.findMany({
      where: {
        following_id: resolvedParams.id,
      },
      include: {
        follower: {
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

    const response: FollowResponse = {
      data: followers,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching followers:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch followers',
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
