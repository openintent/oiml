import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { OrderResponse, ErrorResponse } from '@/packages/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ order_number: string }> }
) {
  const resolvedParams = await params;

  try {
    const order = await prisma.order.findUnique({
      where: { order_number: resolvedParams.order_number },
      include: {
        items: {
          include: {
            product_variant: {
              include: {
                product: true,
              },
            },
          },
        },
        customer: true,
        shipping_address: true,
        billing_address: true,
      },
    });

    if (!order) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Order not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: OrderResponse = {
      data: order,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching order by number:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch order'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}



