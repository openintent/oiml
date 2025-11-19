import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { CustomerInterface, CustomerResponse, ErrorResponse } from "@/packages/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: resolvedParams.id },
      include: {
        addresses: true,
        orders: true
      }
    });

    if (!customer) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Customer not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const response: CustomerResponse = {
      data: customer
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching customer:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch customer"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const body: Partial<CustomerInterface> = await request.json();

    const existing = await prisma.customer.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Customer not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const customer = await prisma.customer.update({
      where: { id: resolvedParams.id },
      data: body
    });

    const response: CustomerResponse = {
      data: customer
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error updating customer:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update customer"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const existing = await prisma.customer.findUnique({
      where: { id: resolvedParams.id }
    });

    if (!existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Customer not found"
      };
      return NextResponse.json(errorResponse, { status: 404 });
    }

    await prisma.customer.delete({
      where: { id: resolvedParams.id }
    });

    return NextResponse.json({ success: true, message: "Customer deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting customer:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete customer"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

