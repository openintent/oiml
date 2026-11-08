import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";

/**
 * POST /api/email/send
 *
 * Send a single transactional email
 *
 * Request body:
 * {
 *   to: string | string[],
 *   subject: string,
 *   html?: string,
 *   text?: string,
 *   from?: string,
 *   replyTo?: string,
 *   cc?: string | string[],
 *   bcc?: string | string[],
 *   tags?: Array<{ name: string, value: string }>,
 *   scheduledAt?: string  // ISO 8601 format
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     id: string,
 *     message: string
 *   }
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { to, subject, html, text, from, replyTo, cc, bcc, tags, scheduledAt } = body;

    // Validation
    if (!to || !subject) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: to, subject"
        },
        { status: 400 }
      );
    }

    if (!html && !text) {
      return NextResponse.json(
        {
          success: false,
          error: "Email must include either html or text content"
        },
        { status: 400 }
      );
    }

    // Send email using Resend
    const result = await sendEmail({
      to,
      subject,
      html,
      text,
      from,
      replyTo,
      cc,
      bcc,
      tags,
      scheduledAt
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: result.id,
          message: result.message
        }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in send email endpoint:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send email"
      },
      { status: 500 }
    );
  }
}
