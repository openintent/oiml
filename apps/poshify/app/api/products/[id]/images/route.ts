import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ProductImageInterface, ProductImageResponse, ErrorResponse } from "@/packages/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const images = await prisma.productImage.findMany({
      where: { product_id: resolvedParams.id },
      orderBy: { position: "asc" }
    });

    const response: ProductImageResponse = {
      data: images
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching product images:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch images"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const body: Partial<ProductImageInterface> = await request.json();

    if (!body.url) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Missing required field: url"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const image = await prisma.productImage.create({
      data: {
        product_id: resolvedParams.id,
        url: body.url,
        alt_text: body.alt_text || null,
        position: body.position || 0
      }
    });

    const response: ProductImageResponse = {
      data: image
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error adding product image:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to add image"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

