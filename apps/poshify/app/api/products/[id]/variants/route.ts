import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ProductVariantInterface, ProductVariantResponse, ErrorResponse } from '@/packages/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;

  try {
    const variants = await prisma.productVariant.findMany({
      where: { product_id: resolvedParams.id },
      orderBy: { created_at: 'asc' },
    });

    const response: ProductVariantResponse = {
      data: variants,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching product variants:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch variants'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;

  try {
    const body: Partial<ProductVariantInterface> = await request.json();

    if (!body.title || body.price === undefined) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Missing required fields: title, price'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const variant = await prisma.productVariant.create({
      data: {
        product_id: resolvedParams.id,
        title: body.title,
        sku: body.sku || null,
        price: body.price,
        compare_at_price: body.compare_at_price || null,
        inventory_quantity: body.inventory_quantity || 0,
        weight: body.weight || null,
        weight_unit: body.weight_unit || 'kg',
        barcode: body.barcode || null,
      },
    });

    const response: ProductVariantResponse = {
      data: variant,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating product variant:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create variant'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}



