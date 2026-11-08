import { NextResponse } from "next/server";
import { headers } from "next/headers";

/**
 * POST /api/email/webhook
 *
 * Handle Resend webhook events
 *
 * Webhook events:
 * - email.sent: Email was sent successfully
 * - email.delivered: Email was delivered to the recipient
 * - email.delivery_delayed: Delivery was delayed
 * - email.complained: Recipient marked email as spam
 * - email.bounced: Email bounced (hard or soft)
 * - email.opened: Recipient opened the email
 * - email.clicked: Recipient clicked a link in the email
 *
 * To configure webhooks:
 * 1. Go to Resend Dashboard → Webhooks
 * 2. Add webhook URL: https://yourdomain.com/api/email/webhook
 * 3. Select events to subscribe to
 * 4. Copy the signing secret and add to .env.local as RESEND_WEBHOOK_SECRET
 *
 * Request body (example):
 * {
 *   type: "email.delivered",
 *   created_at: "2025-01-01T12:00:00.000Z",
 *   data: {
 *     email_id: "abc123",
 *     from: "sender@example.com",
 *     to: ["recipient@example.com"],
 *     subject: "Test email",
 *     created_at: "2025-01-01T11:59:00.000Z"
 *   }
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const headersList = await headers();

    // Optional: Verify webhook signature for security
    // const signature = headersList.get("svix-signature");
    // const timestamp = headersList.get("svix-timestamp");
    // const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    //
    // if (webhookSecret && signature && timestamp) {
    //   // Verify the webhook signature using Svix
    //   // See: https://resend.com/docs/dashboard/webhooks/verify-signature
    // }

    const { type, data } = body;

    console.log(`Received Resend webhook: ${type}`, data);

    // Handle different event types
    switch (type) {
      case "email.sent":
        // Email was accepted by Resend and is being processed
        console.log(`Email sent: ${data.email_id}`);
        // TODO: Update your database: mark email as sent
        break;

      case "email.delivered":
        // Email was successfully delivered to the recipient
        console.log(`Email delivered: ${data.email_id}`);
        // TODO: Update your database: mark email as delivered
        break;

      case "email.delivery_delayed":
        // Email delivery was delayed (temporary issue)
        console.log(`Email delivery delayed: ${data.email_id}`);
        // TODO: Update your database: mark email as delayed
        break;

      case "email.bounced":
        // Email bounced (hard or soft bounce)
        console.log(`Email bounced: ${data.email_id}`, {
          reason: data.bounce?.reason,
          bounceType: data.bounce?.type
        });
        // TODO: Update your database: mark email as bounced
        // TODO: For hard bounces, consider removing email from mailing list
        break;

      case "email.complained":
        // Recipient marked email as spam
        console.log(`Email complaint: ${data.email_id}`);
        // TODO: Update your database: mark email as complained
        // TODO: Consider unsubscribing the recipient
        break;

      case "email.opened":
        // Recipient opened the email (requires tracking enabled)
        console.log(`Email opened: ${data.email_id}`);
        // TODO: Track email opens in your analytics
        break;

      case "email.clicked":
        // Recipient clicked a link in the email (requires tracking enabled)
        console.log(`Email link clicked: ${data.email_id}`, {
          link: data.click?.link
        });
        // TODO: Track link clicks in your analytics
        break;

      default:
        console.log(`Unknown webhook event type: ${type}`);
    }

    // Always return 200 OK to acknowledge receipt
    return NextResponse.json(
      {
        success: true,
        message: "Webhook processed"
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error processing webhook:", error);

    // Return 200 even on error to prevent Resend from retrying
    // Log the error for debugging
    return NextResponse.json(
      {
        success: false,
        error: "Internal error processing webhook"
      },
      { status: 200 }
    );
  }
}
