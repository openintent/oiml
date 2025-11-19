import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { CategoryInterface, CategoryResponse, ErrorResponse } from "@/packages/types";

export async function GET() {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        products: true
      }
    });

    const response: CategoryResponse = {
      data: categories
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching categories:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch categories"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: Partial<CategoryInterface> = await request.json();

    if (!body.name || !body.slug) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Missing required fields: name, slug"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const category = await prisma.category.create({
      data: {
        name: body.name,
        slug: body.slug,
        description: body.description || null,
        image_url: body.image_url || null
      }
    });

    const response: CategoryResponse = {
      data: category
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating category:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create category"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

