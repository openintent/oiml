import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { CreateProjectRequest, CreateProjectResponse, ErrorResponse } from "@/packages/types";

export async function POST(request: Request) {
  try {
    const body: CreateProjectRequest = await request.json();

    // Validate name is provided
    if (!body.name || typeof body.name !== "string") {
      const errorResponse: ErrorResponse = {
        error: "Name is required and must be a string"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Validate user_id is provided
    if (!body.user_id || typeof body.user_id !== "string") {
      const errorResponse: ErrorResponse = {
        error: "User ID is required and must be a string"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Validate user exists
    const user = await prisma.user.findUnique({
      where: { id: body.user_id }
    });

    if (!user) {
      const errorResponse: ErrorResponse = {
        error: "User not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Create project
    const project = await prisma.project.create({
      data: {
        id: randomUUID(),
        name: body.name,
        description: body.description,
        user_id: body.user_id
      }
    });

    const response: CreateProjectResponse = {
      data: project
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating project:", error);

    // Handle foreign key constraint violation
    if (
      error instanceof Error &&
      (error.message.includes("Foreign key constraint") ||
        error.message.includes("Foreign key constraint failed") ||
        error.message.includes("user_id"))
    ) {
      const errorResponse: ErrorResponse = {
        error: "Invalid user ID"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const errorResponse: ErrorResponse = {
      error: error instanceof Error ? error.message : "Failed to create project"
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}
