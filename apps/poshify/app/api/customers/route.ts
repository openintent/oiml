import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { CustomerInterface, CustomerResponse, ErrorResponse } from "@/packages/types";

export async function GET() {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { created_at: "desc" },
      include: {
        addresses: true,
        orders: true
      }
    });

    const response: CustomerResponse = {
      data: customers
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching customers:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch customers"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: Partial<CustomerInterface> = await request.json();

    if (!body.email) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Missing required field: email"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const customer = await prisma.customer.create({
      data: {
        email: body.email,
        first_name: body.first_name || null,
        last_name: body.last_name || null,
        phone: body.phone || null,
        accepts_marketing: body.accepts_marketing || false
      }
    });

    const response: CustomerResponse = {
      data: customer
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating customer:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create customer"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

