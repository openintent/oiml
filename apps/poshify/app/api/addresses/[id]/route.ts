import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AddressInterface, AddressResponse, ErrorResponse } from '@/packages/types';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;

  try {
    const body: Partial<AddressInterface> = await request.json();

    const existing = await prisma.address.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Address not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const address = await prisma.address.update({
      where: { id: resolvedParams.id },
      data: body,
    });

    const response: AddressResponse = {
      data: address,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error updating address:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update address'
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
    const existing = await prisma.address.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Address not found'
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    await prisma.address.delete({
      where: { id: resolvedParams.id }
    });

    return NextResponse.json(
      { success: true, message: 'Address deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting address:', error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete address'
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}



