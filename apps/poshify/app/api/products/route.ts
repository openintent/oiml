import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ProductInterface, ProductResponse, ErrorResponse } from '@/packages/types';

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        variants: true,
        images: true,
        categories: true,
      },
    });

    const response: ProductResponse = {
      data: products,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching products:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch products'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: Partial<ProductInterface> = await request.json();

    if (!body.title || !body.slug) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Missing required fields: title, slug'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const product = await prisma.product.create({
      data: {
        title: body.title,
        slug: body.slug,
        description: body.description || null,
        status: body.status || 'draft',
      },
    });

    const response: ProductResponse = {
      data: product,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating product:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create product'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}



