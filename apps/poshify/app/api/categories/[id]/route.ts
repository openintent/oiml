import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { CategoryInterface, CategoryResponse, ErrorResponse } from "@/packages/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const category = await prisma.category.findUnique({
      where: { id: resolvedParams.id },
      include: {
        products: true
      }
    });

    if (!category) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Category not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: CategoryResponse = {
      data: category
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching category:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch category"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const body: Partial<CategoryInterface> = await request.json();

    const existing = await prisma.category.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Category not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const category = await prisma.category.update({
      where: { id: resolvedParams.id },
      data: body
    });

    const response: CategoryResponse = {
      data: category
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error updating category:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update category"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const existing = await prisma.category.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Category not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    await prisma.category.delete({
      where: { id: resolvedParams.id }
    });

    return NextResponse.json({ success: true, message: "Category deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting category:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete category"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
