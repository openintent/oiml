import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ProfileResponse, ErrorResponse } from "@/packages/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const profileId = parseInt(resolvedParams.id);

    if (isNaN(profileId)) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Invalid profile ID"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const profile = await prisma.profile.findUnique({
      where: { id: profileId }
    });

    if (!profile) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Profile not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: ProfileResponse = {
      data: profile
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching profile:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch profile"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
