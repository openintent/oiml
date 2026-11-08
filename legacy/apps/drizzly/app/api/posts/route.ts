import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDbErrorCode } from "@/lib/db-errors";
import { posts as postsTable } from "@/lib/schema";
import type { DataResponse, ErrorResponse, NewPostInterface, PostInterface, PostWithAuthor } from "@/packages/types";

export async function GET() {
  try {
    const posts = await db.query.posts.findMany({
      with: { author: true },
      orderBy: (posts, { desc }) => [desc(posts.created_at)]
    });

    const response: DataResponse<PostWithAuthor[]> = { data: posts };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching posts:", error);
    const errorResponse: ErrorResponse = { success: false, error: "Failed to fetch posts" };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: Partial<NewPostInterface> = await request.json();

    if (!body.title || !body.content || !body.author_id) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Missing required fields: title, content, author_id"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const [post] = await db
      .insert(postsTable)
      .values({
        title: body.title,
        content: body.content,
        author_id: body.author_id,
        published: body.published ?? false
      })
      .returning();

    const response: DataResponse<PostInterface> = { data: post };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    const code = getDbErrorCode(error);
    if (code === "23503" || code === "22P02") {
      const errorResponse: ErrorResponse = { success: false, error: "author_id does not reference an existing user" };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    console.error("Error creating post:", error);
    const errorResponse: ErrorResponse = { success: false, error: "Failed to create post" };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
