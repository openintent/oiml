import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ProductVariantInterface, ProductVariantResponse, ErrorResponse } from '@/packages/types';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;

  try {
    const body: Partial<ProductVariantInterface> = await request.json();

    const existing = await prisma.productVariant.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Product variant not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const variant = await prisma.productVariant.update({
      where: { id: resolvedParams.id },
      data: body,
    });

    const response: ProductVariantResponse = {
      data: variant,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error updating product variant:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update variant'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;

  try {
    const existing = await prisma.productVariant.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Product variant not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    await prisma.productVariant.delete({
      where: { id: resolvedParams.id }
    });

    return NextResponse.json(
      { success: true, message: 'Product variant deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting product variant:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete variant'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}



