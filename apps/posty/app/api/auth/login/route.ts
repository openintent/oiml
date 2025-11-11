import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import type { ErrorResponse } from "@/packages/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Email and password are required",
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Find user by email (include password for verification)
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.password) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Invalid email or password",
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Invalid email or password",
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    // Create session using NextAuth signIn
    // This will set the session cookie automatically
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      // If signIn returns an error, handle it
      if (result?.error) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: "Authentication failed",
        };
        return NextResponse.json(errorResponse, { status: 401 });
      }
    } catch (error) {
      // signIn might throw for various reasons
      console.error("SignIn error:", error);
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Failed to create session",
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }

    // Return user data (password excluded)
    delete (user as any).password; // eslint-disable-line @typescript-eslint/no-explicit-any
    return NextResponse.json({ success: true, data: user }, { status: 200 });
  } catch (error) {
    console.error("Error logging in:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to log in",
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

