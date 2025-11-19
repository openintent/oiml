import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { OrderInterface, OrderResponse, ErrorResponse } from "@/packages/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const order = await prisma.order.findUnique({
      where: { id: resolvedParams.id },
      include: {
        items: {
          include: {
            product_variant: {
              include: {
                product: true
              }
            }
          }
        },
        customer: true,
        shipping_address: true,
        billing_address: true
      }
    });

    if (!order) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Order not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: OrderResponse = {
      data: order
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching order:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch order"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const body: Partial<OrderInterface> = await request.json();

    const existing = await prisma.order.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Order not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const order = await prisma.order.update({
      where: { id: resolvedParams.id },
      data: body
    });

    const response: OrderResponse = {
      data: order
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error updating order:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update order"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

