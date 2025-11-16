import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { CartItemInterface, CartItemResponse, ErrorResponse } from "@/packages/types";

export async function POST(request: Request) {
  try {
    const body: Partial<CartItemInterface> = await request.json();

    if (!body.cart_id || !body.product_variant_id || !body.quantity) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Missing required fields: cart_id, product_variant_id, quantity"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Check if item already exists in cart
    const existingItem = await prisma.cartItem.findFirst({
      where: {
        cart_id: body.cart_id,
        product_variant_id: body.product_variant_id
      }
    });

    if (existingItem) {
      // Update quantity
      const updatedItem = await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: {
          quantity: existingItem.quantity + body.quantity
        },
        include: {
          product_variant: {
            include: {
              product: true
            }
          }
        }
      });

      const response: CartItemResponse = {
        data: updatedItem
      };

      return NextResponse.json(response, { status: 200 });
    }

    const cartItem = await prisma.cartItem.create({
      data: {
        cart_id: body.cart_id,
        product_variant_id: body.product_variant_id,
        quantity: body.quantity
      },
      include: {
        product_variant: {
          include: {
            product: true
          }
        }
      }
    });

    const response: CartItemResponse = {
      data: cartItem
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error adding cart item:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to add cart item"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
