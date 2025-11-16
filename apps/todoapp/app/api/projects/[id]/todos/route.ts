import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TodosResponse, ErrorResponse } from "@/packages/types";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    // Handle both Next.js 15+ (async params) and earlier versions
    const resolvedParams = params instanceof Promise ? await params : params;
    const projectId = resolvedParams.id;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(projectId)) {
      const errorResponse: ErrorResponse = {
        error: "Invalid project ID format"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId }
    });

    if (!project) {
      const errorResponse: ErrorResponse = {
        error: "Project not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Fetch todos for the project
    const todos = await prisma.todo.findMany({
      where: {
        project_id: projectId
      },
      orderBy: {
        created_at: "desc"
      }
    });

    const response: TodosResponse = {
      data: todos
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching project todos:", error);
    const errorResponse: ErrorResponse = {
      error: error instanceof Error ? error.message : "Failed to fetch todos"
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}
