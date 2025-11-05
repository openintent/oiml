import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { UserInterface, UserResponse, ErrorResponse } from '@/packages/types';

export async function GET() {
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
        email: body.email,
        name: body.name ?? null,
      }
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

