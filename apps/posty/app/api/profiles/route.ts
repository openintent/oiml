import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ProfileResponse, ErrorResponse } from '@/packages/types';

export async function GET() {
  try {
    const profiles = await prisma.profile.findMany({
      orderBy: { id: 'desc' }
    });

    const response: ProfileResponse = {
      data: profiles,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching profiles:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch profiles'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

