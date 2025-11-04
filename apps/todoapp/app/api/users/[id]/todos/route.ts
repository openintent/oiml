import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { TodosResponse, ErrorResponse } from '@/packages/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Handle both Next.js 15+ (async params) and earlier versions
    const resolvedParams = params instanceof Promise ? await params : params;
    const userId = resolvedParams.id;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      const errorResponse: ErrorResponse = {
        error: 'Invalid user ID format'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Verify user exists
    const user = await (prisma as any).user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      const errorResponse: ErrorResponse = {
        error: 'User not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Fetch todos for the user
    const todos = await prisma.todo.findMany({
      where: {
        user_id: userId
      } as any,
      orderBy: {
        created_at: 'desc'
      }
    });

    const response: TodosResponse = {
      data: todos as any
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching user todos:', error);
    const errorResponse: ErrorResponse = {
      error: error instanceof Error ? error.message : 'Failed to fetch todos'
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

