import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { CreateUserRequest, CreateUserResponse, ErrorResponse } from '@/packages/types';

export async function POST(request: Request) {
  try {
    const body: CreateUserRequest = await request.json();
    
    // Validate email is provided
    if (!body.email || typeof body.email !== 'string') {
      const errorResponse: ErrorResponse = {
        error: 'Email is required and must be a string'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      const errorResponse: ErrorResponse = {
        error: 'Invalid email format'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    
    // Create user
    const user = await (prisma as any).user.create({
      data: {
        id: randomUUID(),
        email: body.email
      }
    });
    
    const response: CreateUserResponse = {
      data: user
    };
    
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    
    // Handle unique constraint violation (duplicate email)
    if (error instanceof Error && (
      error.message.includes('Unique constraint') || 
      error.message.includes('Unique constraint failed') ||
      error.message.includes('email')
    )) {
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

