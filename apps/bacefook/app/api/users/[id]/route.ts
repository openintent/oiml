import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { UserResponse, ErrorResponse } from "@/packages/types";

// GET /api/users/:id - Get user by ID
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolvedParams = await params;

    const user = await prisma.user.findUnique({
      where: { id: resolvedParams.id },
      select: {
        id: true,
        email: true,
        username: true,
        first_name: true,
        last_name: true,
        is_active: true,
        is_verified: true,
        created_at: true,
        updated_at: true
      }
    });

    if (!user) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "User not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: UserResponse = {
      data: user
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching user:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch user"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
