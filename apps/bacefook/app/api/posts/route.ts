import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/posts - Create a new post
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
    const { content, visibility } = body;

    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: content' },
        { status: 400 }
      );
    }

    const post = await prisma.post.create({
      data: {
        author_id: userId,
        content,
        visibility: visibility || 'public',
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });

    return NextResponse.json({ data: post }, { status: 201 });
  } catch (error) {
    console.error('Error creating post:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create post' },
      { status: 500 }
    );
  }
}

// GET /api/posts - Get posts feed (timeline)
export async function GET() {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);

    const posts = await prisma.post.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
      take: 50, // Limit to 50 posts
    });

    return NextResponse.json({ data: posts }, { status: 200 });
  } catch (error) {
    console.error('Error fetching posts:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch posts' },
      { status: 500 }
    );
  }
}



