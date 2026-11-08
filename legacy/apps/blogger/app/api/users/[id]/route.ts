import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { UserInterface, UserResponse, ErrorResponse } from "@/packages/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Resolve params (Next.js 15+ passes params as a Promise)
  const resolvedParams = await params;

  try {
    const user = await prisma.user.findUnique({
      where: { id: resolvedParams.id }
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

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Resolve params (Next.js 15+ passes params as a Promise)
  const resolvedParams = await params;

  try {
    const body: Partial<UserInterface> = await request.json();

    // Check if user exists
    const existing = await prisma.user.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "User not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const user = await prisma.user.update({
      where: { id: resolvedParams.id },
      data: {
        email: body.email,
        first_name: body.first_name,
        last_name: body.last_name
      }
    });

    const response: UserResponse = {
      data: user
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error updating user:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update user"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Resolve params (Next.js 15+ passes params as a Promise)
  const resolvedParams = await params;

  try {
    // Check if user exists
    const existing = await prisma.user.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "User not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    await prisma.user.delete({
      where: { id: resolvedParams.id }
    });

    return NextResponse.json({ success: true, message: "User deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting user:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete user"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
