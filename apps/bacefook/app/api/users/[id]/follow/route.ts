import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { FollowResponse, ErrorResponse } from '@/packages/types';

// POST /api/users/:id/follow - Follow a user
export async function POST(
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
    const followingId = resolvedParams.id;

    if (userId === followingId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Cannot follow yourself',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Check if already following
    const existingFollow = await prisma.follow.findUnique({
      where: {
        follower_id_following_id: {
          follower_id: userId,
          following_id: followingId,
        },
      },
    });

    if (existingFollow) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Already following this user',
      };
      return NextResponse.json(errorResponse, { status: 409 });
    }

    const follow = await prisma.follow.create({
      data: {
        follower_id: userId,
        following_id: followingId,
      },
    });

    const response: FollowResponse = {
      data: follow,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error following user:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to follow user',
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// DELETE /api/users/:id/follow - Unfollow a user
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
    const followingId = resolvedParams.id;

    const existingFollow = await prisma.follow.findUnique({
      where: {
        follower_id_following_id: {
          follower_id: userId,
          following_id: followingId,
        },
      },
    });

    if (!existingFollow) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Not following this user',
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    await prisma.follow.delete({
      where: {
        id: existingFollow.id,
      },
    });

    return NextResponse.json(
      { success: true, message: 'Unfollowed successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error unfollowing user:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to unfollow user',
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
