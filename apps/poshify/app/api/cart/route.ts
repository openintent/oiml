import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { CartInterface, CartResponse, ErrorResponse } from "@/packages/types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get("customer_id");
    const sessionId = searchParams.get("session_id");

    if (!customerId && !sessionId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Must provide either customer_id or session_id"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const whereClause = customerId ? { customer_id: customerId } : { session_id: sessionId };

    const cart = await prisma.cart.findFirst({
      where: whereClause,
      include: {
        items: {
          include: {
            product_variant: {
              include: {
                product: true
              }
            }
          }
        }
      }
    });

    if (!cart) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Cart not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: CartResponse = {
      data: cart
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching cart:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch cart"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: Partial<CartInterface> = await request.json();

    if (!body.customer_id && !body.session_id) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Must provide either customer_id or session_id"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Check if cart already exists
    const whereClause = body.customer_id ? { customer_id: body.customer_id } : { session_id: body.session_id };

    const existingCart = await prisma.cart.findFirst({
      where: whereClause,
      include: {
        items: {
          include: {
            product_variant: {
              include: {
                product: true
              }
            }
          }
        }
      }
    });

    if (existingCart) {
      const response: CartResponse = {
        data: existingCart
      };
      return NextResponse.json(response, { status: 200 });
    }

    // Create new cart
    const cart = await prisma.cart.create({
      data: {
        customer_id: body.customer_id || null,
        session_id: body.session_id || null
      },
      include: {
        items: true
      }
    });

    const response: CartResponse = {
      data: cart
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating cart:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create cart"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
