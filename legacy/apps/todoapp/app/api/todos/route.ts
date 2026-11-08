import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TodosResponse, ErrorResponse } from "@/packages/types";

export async function GET() {
  try {
    const todos = await prisma.todo.findMany({
      orderBy: {
        created_at: "desc"
      }
    });

    const response: TodosResponse = {
      data: todos
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching todos:", error);
    const errorResponse: ErrorResponse = {
      error: error instanceof Error ? error.message : "Failed to fetch todos"
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}
