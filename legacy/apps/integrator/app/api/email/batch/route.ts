import { NextResponse } from "next/server";
import { sendBatchEmails } from "@/lib/email";

/**
 * POST /api/email/batch
 *
 * Send multiple transactional emails in a batch
 *
 * Request body:
 * {
 *   emails: Array<{
 *     to: string | string[],
 *     subject: string,
 *     html?: string,
 *     text?: string,
 *     from?: string,
 *     replyTo?: string
 *   }>
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     ids: string[],
 *     message: string
 *   }
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { emails } = body;

    // Validation
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "emails array is required and must not be empty"
        },
        { status: 400 }
      );
    }

    // Validate each email in the batch
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      if (!email.to || !email.subject) {
        return NextResponse.json(
          {
            success: false,
            error: `Email at index ${i} is missing required fields: to, subject`
          },
          { status: 400 }
        );
      }

      if (!email.html && !email.text) {
        return NextResponse.json(
          {
            success: false,
            error: `Email at index ${i} must include either html or text content`
          },
          { status: 400 }
        );
      }
    }

    // Send batch emails using Resend
    const result = await sendBatchEmails({ emails });

    return NextResponse.json(
      {
        success: true,
        data: {
          ids: result.ids,
          message: result.message
        }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in batch email endpoint:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send batch emails"
      },
      { status: 500 }
    );
  }
}
