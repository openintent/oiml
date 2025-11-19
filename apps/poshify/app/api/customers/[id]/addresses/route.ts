import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { AddressInterface, AddressResponse, ErrorResponse } from "@/packages/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const addresses = await prisma.address.findMany({
      where: { customer_id: resolvedParams.id },
      orderBy: { is_default: "desc" }
    });

    const response: AddressResponse = {
      data: addresses
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error fetching customer addresses:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch addresses"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  try {
    const body: Partial<AddressInterface> = await request.json();

    if (
      !body.first_name ||
      !body.last_name ||
      !body.address1 ||
      !body.city ||
      !body.province ||
      !body.country ||
      !body.zip
    ) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: "Missing required fields: first_name, last_name, address1, city, province, country, zip"
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const address = await prisma.address.create({
      data: {
        customer_id: resolvedParams.id,
        first_name: body.first_name,
        last_name: body.last_name,
        company: body.company || null,
        address1: body.address1,
        address2: body.address2 || null,
        city: body.city,
        province: body.province,
        country: body.country,
        zip: body.zip,
        phone: body.phone || null,
        is_default: body.is_default || false
      }
    });

    const response: AddressResponse = {
      data: address
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error adding customer address:", error);
    const errorResponse: ErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to add address"
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

