import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { EventResponse, ErrorResponse } from "@/packages/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Resolve params (Next.js 15+ passes params as a Promise)
  const resolvedParams = await params;

  try {
    const event = await prisma.event.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!event) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Event not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: EventResponse = {
      data: event
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching event:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch event"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}




