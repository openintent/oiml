import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { OrderResponse, ErrorResponse } from '@/packages/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;

  try {
    const orders = await prisma.order.findMany({
      where: { customer_id: resolvedParams.id },
      orderBy: { created_at: 'desc' },
      include: {
        items: true,
        shipping_address: true,
        billing_address: true,
      },
    });

    const response: OrderResponse = {
      data: orders,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching customer orders:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch orders'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}



