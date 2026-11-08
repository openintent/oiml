import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// POST /api/users - Create a new user account
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, username, password, first_name, last_name } = body;

    // Validation
    if (!email || !username || !password) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: email, username, password" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }]
      }
    });

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: "User with this email or username already exists" },
        { status: 409 }
      );
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        username,
        password_hash,
        first_name: first_name || null,
        last_name: last_name || null
      },
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

    return NextResponse.json({ data: user }, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create user" },
      { status: 500 }
    );
  }
}
