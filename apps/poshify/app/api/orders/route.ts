import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { OrderInterface, OrderResponse, ErrorResponse } from '@/packages/types';

export async function GET() {
  try {
    const orders = await prisma.order.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        items: true,
        customer: true,
        shipping_address: true,
        billing_address: true,
      },
    });

    const response: OrderResponse = {
      data: orders,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching orders:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch orders'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: Partial<OrderInterface> = await request.json();

    if (!body.order_number || !body.email || body.subtotal_price === undefined || body.total_price === undefined) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Missing required fields: order_number, email, subtotal_price, total_price'
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const order = await prisma.order.create({
      data: {
        order_number: body.order_number,
        customer_id: body.customer_id || null,
        email: body.email,
        financial_status: body.financial_status || 'pending',
        fulfillment_status: body.fulfillment_status || 'unfulfilled',
        subtotal_price: body.subtotal_price,
        total_tax: body.total_tax || 0,
        total_discounts: body.total_discounts || 0,
        total_price: body.total_price,
        currency: body.currency || 'USD',
        shipping_address_id: body.shipping_address_id || null,
        billing_address_id: body.billing_address_id || null,
      },
    });

    const response: OrderResponse = {
      data: order,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('Error creating order:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create order'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}



