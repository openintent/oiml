import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ErrorResponse } from "@/packages/types";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const existing = await prisma.productImage.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Product image not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    await prisma.productImage.delete({
      where: { id: resolvedParams.id }
    });

    return NextResponse.json({ success: true, message: "Product image deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting product image:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete image"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

