import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { FriendshipResponse, ErrorResponse } from "@/packages/types";

// PUT /api/friendships/:id - Accept or reject a friend request
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const userId = ""; // Placeholder

    if (!userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Authentication required"
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    const resolvedParams = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || (status !== "accepted" && status !== "blocked")) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Invalid status. Must be "accepted" or "blocked"'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Check if friendship exists and user is the recipient
    const existingFriendship = await prisma.friendship.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existingFriendship) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Friendship not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Only the recipient (friend_id) can accept/reject
    if (existingFriendship.friend_id !== userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Unauthorized - only the recipient can update this friendship"
      };
      return NextResponse.json(errorResponse, { status: 403 });
    }

    const friendship = await prisma.friendship.update({
      where: { id: resolvedParams.id },
      data: { status },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true
          }
        },
        friend: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true
          }
        }
      }
    });

    const response: FriendshipResponse = {
      data: friendship
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error updating friendship:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update friendship"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// DELETE /api/friendships/:id - Remove a friendship
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // TODO: Implement authentication middleware
    // const userId = await getCurrentUserId(request);
    const userId = ""; // Placeholder

    if (!userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Authentication required"
      };
      return NextResponse.json(errorResponse, { status: 401 });
    }

    const resolvedParams = await params;

    // Check if friendship exists and user is involved
    const existingFriendship = await prisma.friendship.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existingFriendship) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Friendship not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Either user can remove the friendship
    if (existingFriendship.user_id !== userId && existingFriendship.friend_id !== userId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Unauthorized - you are not part of this friendship"
      };
      return NextResponse.json(errorResponse, { status: 403 });
    }

    await prisma.friendship.delete({
      where: { id: resolvedParams.id }
    });

    return NextResponse.json({ success: true, message: "Friendship removed successfully" }, { status: 200 });
  } catch (error) {
    console.error("Error removing friendship:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to remove friendship"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
