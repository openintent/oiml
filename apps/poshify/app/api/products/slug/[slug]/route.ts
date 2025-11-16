import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ProductResponse, ErrorResponse } from '@/packages/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const resolvedParams = await params;

  try {
    const product = await prisma.product.findUnique({
      where: { slug: resolvedParams.slug },
      include: {
        variants: true,
        images: true,
        categories: true,
      },
    });

    if (!product) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Product not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: ProductResponse = {
      data: product,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching product by slug:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch product'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}



