import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDbErrorCode } from "@/lib/db-errors";
import type { DataResponse, ErrorResponse, UserWithPosts } from "@/packages/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const user = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, id),
      with: { posts: { orderBy: (posts, { desc }) => [desc(posts.created_at)] } }
    });

    if (!user) {
      const errorResponse: ErrorResponse = { success: false, error: "User not found" };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: DataResponse<UserWithPosts> = { data: user };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    // A malformed UUID cannot match any user
    if (getDbErrorCode(error) === "22P02") {
      const errorResponse: ErrorResponse = { success: false, error: "User not found" };
      return NextResponse.json(errorResponse, { status: 404 });
    }
    console.error("Error fetching user:", error);
    const errorResponse: ErrorResponse = { success: false, error: "Failed to fetch user" };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
