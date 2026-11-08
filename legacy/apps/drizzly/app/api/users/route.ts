import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDbErrorCode } from "@/lib/db-errors";
import { users as usersTable } from "@/lib/schema";
import type { DataResponse, ErrorResponse, NewUserInterface, UserInterface } from "@/packages/types";

export async function POST(request: Request) {
  try {
    const body: Partial<NewUserInterface> = await request.json();

    if (!body.email || !body.name) {
      const errorResponse: ErrorResponse = { success: false, error: "Missing required fields: email, name" };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const [user] = await db.insert(usersTable).values({ email: body.email, name: body.name }).returning();

    const response: DataResponse<UserInterface> = { data: user };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (getDbErrorCode(error) === "23505") {
      const errorResponse: ErrorResponse = { success: false, error: "A user with this email already exists" };
      return NextResponse.json(errorResponse, { status: 409 });
    }
    console.error("Error creating user:", error);
    const errorResponse: ErrorResponse = { success: false, error: "Failed to create user" };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
