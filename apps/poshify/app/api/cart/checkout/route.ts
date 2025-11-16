import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { OrderResponse, ErrorResponse } from "@/packages/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cart_id, email, customer_id, shipping_address_id, billing_address_id } = body;

    if (!cart_id || !email) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Missing required fields: cart_id, email"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Fetch cart with items
    const cart = await prisma.cart.findUnique({
      where: { id: cart_id },
      include: {
        items: {
          include: {
            product_variant: true
          }
        }
      }
    });

    if (!cart || cart.items.length === 0) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Cart not found or is empty"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Calculate totals
    const subtotal = cart.items.reduce((sum, item) => {
      return sum + Number(item.product_variant.price) * item.quantity;
    }, 0);

    const total_tax = subtotal * 0.1; // 10% tax for example
    const total_price = subtotal + total_tax;

    // Generate order number
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

    // Create order
    const order = await prisma.order.create({
      data: {
        order_number: orderNumber,
        customer_id: customer_id || null,
        email,
        financial_status: "pending",
        fulfillment_status: "unfulfilled",
        subtotal_price: subtotal,
        total_tax,
        total_discounts: 0,
        total_price,
        currency: "USD",
        shipping_address_id: shipping_address_id || null,
        billing_address_id: billing_address_id || null,
        items: {
          create: cart.items.map(item => ({
            product_variant_id: item.product_variant_id,
            title: item.product_variant.title,
            quantity: item.quantity,
            price: item.product_variant.price,
            sku: item.product_variant.sku
          }))
        }
      },
      include: {
        items: true,
        customer: true,
        shipping_address: true,
        billing_address: true
      }
    });

    // Clear cart items
    await prisma.cartItem.deleteMany({
      where: { cart_id }
    });

    const response: OrderResponse = {
      data: order
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error checking out cart:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to checkout cart"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
