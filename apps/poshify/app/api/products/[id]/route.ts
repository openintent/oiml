import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ProductInterface, ProductResponse, ErrorResponse } from "@/packages/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const product = await prisma.product.findUnique({
      where: { id: resolvedParams.id },
      include: {
        variants: true,
        images: true,
        categories: true
      }
    });

    if (!product) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Product not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: ProductResponse = {
      data: product
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching product:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch product"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const body: Partial<ProductInterface> = await request.json();

    const existing = await prisma.product.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Product not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const product = await prisma.product.update({
      where: { id: resolvedParams.id },
      data: body
    });

    const response: ProductResponse = {
      data: product
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error updating product:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update product"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const existing = await prisma.product.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Product not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    await prisma.product.delete({
      where: { id: resolvedParams.id }
    });

    return NextResponse.json({ success: true, message: "Product deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting product:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete product"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

