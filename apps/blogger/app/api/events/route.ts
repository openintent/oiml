import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { EventInterface, EventResponse, ErrorResponse } from "@/packages/types";

export async function GET() {
  try {
    const events = await prisma.event.findMany({
      orderBy: { title: "asc" }
    });

    const response: EventResponse = {
      data: events
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching events:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch events"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: Partial<EventInterface> = await request.json();

    // Validate required fields
    if (!body.title) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Missing required field: title"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const event = await prisma.event.create({
      data: {
        title: body.title
      }
    });

    const response: EventResponse = {
      data: event
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating event:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create event"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}




