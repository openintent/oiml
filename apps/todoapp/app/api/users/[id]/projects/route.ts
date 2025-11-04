import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ProjectsResponse, ErrorResponse } from '@/packages/types';

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
        success: false,
        error: 'Invalid user ID format'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'User not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Fetch projects for the user
    const projects = await prisma.project.findMany({
      where: {
        user_id: userId
      },
      orderBy: {
        created_at: 'desc'
      }
    });

    const response: ProjectsResponse = {
      success: true,
      data: projects,
      count: projects.length
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching user projects:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch projects'
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

