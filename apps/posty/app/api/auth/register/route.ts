import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import type { ErrorResponse } from "@/packages/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, first_name, last_name } = body;

    if (!email || !password) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Email and password are required"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "User with this email already exists"
      };
      return NextResponse.json(errorResponse, { status: 409 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        first_name: first_name || null,
        last_name: last_name || null
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true
      }
    });

    return NextResponse.json({ data: user }, { status: 201 });
  } catch (error) {
    console.error("Error registering user:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to register user"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
