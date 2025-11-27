import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/friendships - Send a friend request
export async function POST(request: Request) {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const userId = ''; // Placeholder

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { friend_id } = body;

    if (!friend_id) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: friend_id' },
        { status: 400 }
      );
    }

    if (userId === friend_id) {
      return NextResponse.json(
        { success: false, error: 'Cannot send friend request to yourself' },
        { status: 400 }
      );
    }

    // Check if friendship already exists
    const existingFriendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { user_id: userId, friend_id },
          { user_id: friend_id, friend_id: userId },
        ],
      },
    });

    if (existingFriendship) {
      return NextResponse.json(
        { success: false, error: 'Friendship already exists' },
        { status: 409 }
      );
    }

    const friendship = await prisma.friendship.create({
      data: {
        user_id: userId,
        friend_id,
        status: 'pending',
      },
      include: {
        friend: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });

    return NextResponse.json({ data: friendship }, { status: 201 });
  } catch (error) {
    console.error('Error creating friendship:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create friendship' },
      { status: 500 }
    );
  }
}

// GET /api/friendships - Get user's friendships
export async function GET() {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const userId = ''; // Placeholder

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { user_id: userId },
          { friend_id: userId },
        ],
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
        friend: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return NextResponse.json({ data: friendships }, { status: 200 });
  } catch (error) {
    console.error('Error fetching friendships:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch friendships' },
      { status: 500 }
    );
  }
}



