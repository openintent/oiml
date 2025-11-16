import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { CartItemInterface, CartItemResponse, ErrorResponse } from '@/packages/types';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;

  try {
    const body: Partial<CartItemInterface> = await request.json();

    const existing = await prisma.cartItem.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Cart item not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const cartItem = await prisma.cartItem.update({
      where: { id: resolvedParams.id },
      data: body,
      include: {
        product_variant: {
          include: {
            product: true,
          },
        },
      },
    });

    const response: CartItemResponse = {
      data: cartItem,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error updating cart item:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update cart item'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;

  try {
    const existing = await prisma.cartItem.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Cart item not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    await prisma.cartItem.delete({
      where: { id: resolvedParams.id }
    });

    return NextResponse.json(
      { success: true, message: 'Cart item removed successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error removing cart item:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove cart item'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}



