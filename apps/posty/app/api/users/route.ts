import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import type { UserInterface, UserResponse, ErrorResponse } from '@/packages/types';
import type { Prisma } from '@prisma/client';

export async function GET() {
  // Defense-in-depth: Check auth in route handler as well
  const session = await auth();
  if (!session) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: 'Unauthorized'
    };
    return NextResponse.json(errorResponse, { status: 401 });
  }
  try {
    const users = await prisma.user.findMany({
      orderBy: { id: 'desc' }
    });

    const response: UserResponse = {
      data: users,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching users:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch users'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: Partial<UserInterface> = await request.json();

    if (!body.email) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Missing required field: email'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const user = await prisma.user.create({
      data: {
        email: body.email as string,
        ...(body.first_name != null && { first_name: body.first_name }),
        ...(body.last_name != null && { last_name: body.last_name }),
      } as Prisma.UserCreateInput
    });

    const response: UserResponse = {
      data: user,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create user'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

