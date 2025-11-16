import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { UserInterface, UserResponse, ErrorResponse } from "@/packages/types";

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      orderBy: { email: "asc" }
    });

    const response: UserResponse = {
      data: users
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching users:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch users"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: Partial<UserInterface> = await request.json();

    // Validate required fields
    if (!body.email || !body.first_name || !body.last_name) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Missing required fields: email, first_name, last_name"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const user = await prisma.user.create({
      data: {
        email: body.email,
        first_name: body.first_name,
        last_name: body.last_name
      }
    });

    const response: UserResponse = {
      data: user
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create user"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
