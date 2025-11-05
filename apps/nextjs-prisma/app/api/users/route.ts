import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { UserResponse, ErrorResponse } from '@/packages/types';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      const errorResponse: ErrorResponse = {
        error: 'Email is required'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      const errorResponse: ErrorResponse = {
        error: 'Invalid email format'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Create new user
    const user = await prisma.user.create({
      data: {
        email,
      },
    });

    const response: UserResponse = {
      data: user,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    
    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      const errorResponse: ErrorResponse = {
        error: 'A user with this email already exists'
      };
      return NextResponse.json(errorResponse, { status: 409 });
    }

    const errorResponse: ErrorResponse = {
      error: error instanceof Error ? error.message : 'Failed to create user'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

