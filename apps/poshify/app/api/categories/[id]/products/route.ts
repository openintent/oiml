import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ProductResponse, ErrorResponse } from '@/packages/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;

  try {
    const category = await prisma.category.findUnique({
      where: { id: resolvedParams.id },
      include: {
        products: {
          include: {
            variants: true,
            images: true,
          },
        },
      },
    });

    if (!category) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Category not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: ProductResponse = {
      data: category.products,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching category products:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch products'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}



