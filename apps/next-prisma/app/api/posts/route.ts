import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { PostInterface, PostResponse, ErrorResponse } from '@/packages/types';

export async function POST(request: Request) {
  try {
    const body: Partial<PostInterface> = await request.json();

    if (!body.title || !body.author_id) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Missing required fields: title, author_id'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Check if author exists
    const author = await prisma.user.findUnique({
      where: { id: body.author_id }
    });

    if (!author) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Author not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const post = await prisma.post.create({
      data: {
        title: body.title,
        content: body.content ?? null,
        published: body.published ?? false,
        author_id: body.author_id,
      }
    });

    const response: PostResponse = {
      data: post,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating post:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create post'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

