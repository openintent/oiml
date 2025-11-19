# Resend Email Capability Implementation Guide

> **Template Version:** 1.0.0  
> **Compatible OIML Versions:** 0.1.x  
> **Compatible Next.js Versions:** 14.x.x, 15.x.x, 16.x.x  
> **Compatible Resend Versions:** 3.x.x, 4.x.x  
> **Last Updated:** 2025-11-18

This guide provides complete implementation instructions for adding email capabilities to Next.js applications using [Resend](https://resend.com/docs/introduction) with the `add_capability` intent.

## When to Use This Guide

Use this guide when:

- `api.framework` in `project.yaml` is set to `"next"`
- An `add_capability` intent with `capability: "email"` and `framework: "next"` is being applied
- You need to implement email sending functionality using Resend

## Prerequisites

- Node.js 18+ is installed
- Next.js 14+ is installed
- A Resend account with API key ([Sign up at resend.com](https://resend.com))
- Verified domain in Resend (for production use)

## Overview

The email capability implements:

- **Resend SDK** for reliable email delivery
- **Transactional emails** for user actions (welcome, password reset, etc.)
- **React Email templates** for beautiful, responsive emails
- **Type-safe email functions** with TypeScript
- **API endpoints** for sending emails from your application
- **Batch sending** for multiple recipients
- **Email scheduling** for delayed delivery
- **Webhook handling** for email events (delivered, opened, clicked, bounced)

## Intent Structure and IR Transformation

### Human-Authored YAML Intent

The developer writes this simplified YAML intent:

```yaml
intents:
  - kind: add_capability
    scope: capability
    capability: email
    framework: next
    provider: resend
    config:
      api_key: env:RESEND_API_KEY
      from_email: noreply@yourdomain.com
      from_name: Your App Name
    endpoints:
      - method: POST
        path: /api/email/send
        description: Send a transactional email
      - method: POST
        path: /api/email/batch
        description: Send emails to multiple recipients
      - method: POST
        path: /api/email/webhook
        description: Handle Resend webhook events
```

### IR Transformation with Email Overlay

**IMPORTANT:** The human-authored YAML intent is validated and transformed into an Intermediate Representation (IR) before code generation. The IR includes a strongly-typed `EmailCapabilityOverlay` that provides structured configuration for email-specific features.

After transformation, the intent becomes:

```typescript
{
  kind: "AddCapability",
  irVersion: "1.0.0",
  provenance: { /* tracking info */ },
  capability: {
    type: "email",
    framework: "next",
    provider: "resend",
    config: {
      api_key: "env:RESEND_API_KEY",
      from_email: "noreply@yourdomain.com",
      from_name: "Your App Name"
    },
    endpoints: [
      { method: "POST", path: "/api/email/send", description: "Send a transactional email" },
      { method: "POST", path: "/api/email/batch", description: "Send emails to multiple recipients" },
      { method: "POST", path: "/api/email/webhook", description: "Handle Resend webhook events" }
    ],
    overlay: {
      type: "email",
      // Optional: Email templates configuration
      templates: [
        {
          name: "welcome",
          subject: "Welcome to {{appName}}",
          format: "react",
          source: "emails/welcome.tsx"
        }
      ],
      // Optional: SMTP configuration (if using custom SMTP)
      smtp: {
        host: "smtp.resend.com",
        port: 587,
        secure: true
      },
      // Optional: Webhook configuration
      webhooks: {
        events: ["email.delivered", "email.opened", "email.clicked", "email.bounced"],
        endpoint: "/api/email/webhook",
        verifySignature: true
      },
      // Optional: Default sender
      from: {
        email: "noreply@yourdomain.com",
        name: "Your App Name"
      }
    }
  },
  diagnostics: []
}
```

### Email Overlay Schema

The `EmailCapabilityOverlay` IR provides:

- **Type Safety**: Strongly-typed configuration preventing errors
- **Template Management**: Structured email template definitions
- **SMTP Configuration**: Optional custom SMTP settings
- **Webhook Events**: Structured webhook event subscriptions
- **Default Sender**: Standardized sender information

### Configuration Options

The `config` object supports:

- `api_key`: Resend API key (use `env:RESEND_API_KEY` format for environment variable)
- `from_email`: Default sender email address (must be verified in Resend)
- `from_name`: Default sender name (optional)
- `reply_to`: Default reply-to email address (optional)

### Endpoint Options

You can customize which endpoints to create:

- **`/api/email/send`**: Single email sending endpoint
- **`/api/email/batch`**: Batch email sending endpoint
- **`/api/email/webhook`**: Webhook handler for email events

### IR-Driven Code Generation

**Code generation uses the IR overlay, not the raw YAML.** This ensures:

1. **Validation**: All configuration is validated before code generation
2. **Type Safety**: The overlay schema enforces correct data types
3. **Consistency**: The IR provides a stable format across different intent versions
4. **Extensibility**: New overlay fields can be added without breaking existing code

## Implementation Steps

**Important:** Before creating any files, check if they already exist. The following steps will create:

- `lib/email.ts` - Resend client configuration and email utilities
- `app/api/email/send/route.ts` - Single email sending endpoint
- `app/api/email/batch/route.ts` - Batch email sending endpoint (optional)
- `app/api/email/webhook/route.ts` - Webhook handler endpoint (optional)
- `emails/` directory - React Email templates (optional but recommended)
- `types/email.ts` - Type definitions for email operations

If any of these files already exist, review them and update as needed rather than overwriting.

### Step 1: Install Dependencies

Install the Resend SDK:

```bash
npm install resend
```

Or with pnpm:

```bash
pnpm add resend
```

**Optional but Recommended:** Install React Email for beautiful email templates:

```bash
npm install @react-email/components
npm install -D @react-email/render
```

Or with pnpm:

```bash
pnpm add @react-email/components
pnpm add -D @react-email/render
```

### Step 2: Configure Environment Variables

Add your Resend API key to `.env.local`:

```bash
RESEND_API_KEY=re_your_api_key_here
```

**Security Notes:**

- Never commit API keys to version control
- Use different API keys for development and production
- Get your API key from [Resend Dashboard](https://resend.com/api-keys)

### Step 3: Create Resend Client and Utilities

**File location:** `lib/email.ts` (based on `paths.utils` from `project.yaml`, defaults to `lib/`)

Create `lib/email.ts`:

````typescript
import { Resend } from "resend";

// Initialize Resend client
// API key comes from environment variable (configured in intent)
if (!process.env.RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY environment variable is required");
}

export const resend = new Resend(process.env.RESEND_API_KEY);

// Default sender configuration from intent config
export const DEFAULT_FROM = {
  email: process.env.FROM_EMAIL || "noreply@yourdomain.com",
  name: process.env.FROM_NAME || "Your App"
};

// Email types for type safety
export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  react?: React.ReactElement;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  tags?: Array<{ name: string; value: string }>;
  scheduledAt?: string; // ISO 8601 format
}

export interface BatchEmailOptions {
  emails: Array<{
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    react?: React.ReactElement;
    from?: string;
    replyTo?: string;
  }>;
}

/**
 * Send a single email using Resend
 *
 * @param options - Email sending options
 * @returns Promise with email ID and any errors
 *
 * @example
 * ```typescript
 * await sendEmail({
 *   to: "user@example.com",
 *   subject: "Welcome to our app!",
 *   html: "<p>Welcome!</p>"
 * });
 * ```
 */
export async function sendEmail(options: SendEmailOptions) {
  try {
    const { to, subject, html, text, react, from, replyTo, cc, bcc, tags, scheduledAt } = options;

    // Build base email data
    const baseData = {
      from: from || `${DEFAULT_FROM.name} <${DEFAULT_FROM.email}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      replyTo,
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      tags,
      scheduledAt
    };

    // Build email data with content
    // Note: This approach avoids TypeScript 'any' type and properly handles Resend's union types
    let emailData;
    if (react) {
      emailData = { ...baseData, react };
    } else if (html) {
      emailData = { ...baseData, html };
    } else if (text) {
      emailData = { ...baseData, text };
    } else {
      throw new Error("Email must include html, text, or react content");
    }

    const result = await resend.emails.send(emailData);

    if (result.error) {
      console.error("Resend API error:", result.error);
      throw new Error(result.error.message || "Failed to send email");
    }

    return {
      success: true,
      id: result.data?.id,
      message: "Email sent successfully"
    };
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}

/**
 * Send multiple emails in a batch
 *
 * @param options - Batch email options
 * @returns Promise with array of email IDs and any errors
 *
 * @example
 * ```typescript
 * await sendBatchEmails({
 *   emails: [
 *     { to: "user1@example.com", subject: "Hello", html: "<p>Hi User 1</p>" },
 *     { to: "user2@example.com", subject: "Hello", html: "<p>Hi User 2</p>" }
 *   ]
 * });
 * ```
 */
export async function sendBatchEmails(options: BatchEmailOptions) {
  try {
    const { emails } = options;

    // Build batch email data
    const emailsData = emails.map(email => ({
      from: email.from || `${DEFAULT_FROM.name} <${DEFAULT_FROM.email}>`,
      to: Array.isArray(email.to) ? email.to : [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      react: email.react,
      replyTo: email.replyTo
    }));

    const result = await resend.batch.send(emailsData);

    if (result.error) {
      console.error("Resend batch API error:", result.error);
      throw new Error(result.error.message || "Failed to send batch emails");
    }

    // Extract IDs from result with proper type handling
    const ids = Array.isArray(result.data)
      ? result.data.map((item: { id?: string }) => item.id).filter((id): id is string => !!id)
      : [];

    return {
      success: true,
      ids,
      message: `Successfully sent ${emails.length} emails`
    };
  } catch (error) {
    console.error("Error sending batch emails:", error);
    throw error;
  }
}

/**
 * Common email templates
 * These are simple examples - use React Email for production templates
 */
export const EmailTemplates = {
  welcome: (name: string, loginUrl: string) => `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2563eb;">Welcome to ${DEFAULT_FROM.name}!</h1>
        <p>Hi ${name},</p>
        <p>Thank you for signing up! We're excited to have you on board.</p>
        <p>
          <a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">
            Get Started
          </a>
        </p>
        <p>If you have any questions, feel free to reply to this email.</p>
        <p>Best regards,<br>The ${DEFAULT_FROM.name} Team</p>
      </body>
    </html>
  `,

  passwordReset: (name: string, resetUrl: string, expiresIn: string) => `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2563eb;">Password Reset Request</h1>
        <p>Hi ${name},</p>
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        <p>
          <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">
            Reset Password
          </a>
        </p>
        <p>This link will expire in ${expiresIn}.</p>
        <p>If you didn't request a password reset, you can safely ignore this email.</p>
        <p>Best regards,<br>The ${DEFAULT_FROM.name} Team</p>
      </body>
    </html>
  `,

  notification: (title: string, message: string, actionUrl?: string, actionText?: string) => `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2563eb;">${title}</h1>
        <p>${message}</p>
        ${
          actionUrl && actionText
            ? `
          <p>
            <a href="${actionUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">
              ${actionText}
            </a>
          </p>
        `
            : ""
        }
        <p>Best regards,<br>The ${DEFAULT_FROM.name} Team</p>
      </body>
    </html>
  `
};
````

**Key Features:**

- **Resend client initialization** with API key from environment
- **Type-safe email functions** with TypeScript interfaces
- **sendEmail function** for single emails with support for HTML, text, and React components
- **sendBatchEmails function** for sending multiple emails efficiently
- **Built-in email templates** for common use cases (welcome, password reset, notifications)
- **Scheduling support** for delayed email delivery
- **Tags support** for email categorization and tracking

**TypeScript Notes:**

- The `sendEmail` function uses conditional object construction to avoid TypeScript's `any` type and properly handle Resend's complex union types for email options
- The `sendBatchEmails` function properly handles the response type with Array.isArray checking and type narrowing for the IDs array
- These patterns ensure zero linter errors and full type safety

### Step 4: Create Email Sending API Endpoint

**CRITICAL:** Check if the route already exists before creating. Verify if `app/api/email/send/route.ts` exists.

**File location:** `app/api/email/send/route.ts` (based on `paths.api: app/api` from `project.yaml`)

Create `app/api/email/send/route.ts`:

```typescript
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

    // Follow api.response.success.object configuration from project.yaml
    // Default to { data: ... } if not configured
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

    // Follow api.response.error configuration from project.yaml
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send email"
      },
      { status: 500 }
    );
  }
}
```

**Endpoint Features:**

- **Type validation** for required fields
- **Support for multiple recipients** (to, cc, bcc)
- **Scheduled sending** with ISO 8601 timestamps
- **Email tags** for categorization and filtering
- **Error handling** with appropriate HTTP status codes

### Step 5: Create Batch Email Sending Endpoint (Optional)

**CRITICAL:** Only create this endpoint if specified in the intent's `endpoints` array.

**File location:** `app/api/email/batch/route.ts`

Create `app/api/email/batch/route.ts`:

```typescript
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
```

**Batch Endpoint Features:**

- **Efficient batch sending** for multiple recipients
- **Per-email validation** with detailed error messages
- **Array of email IDs** returned for tracking
- **Cost-effective** for sending many emails at once

### Step 6: Create Webhook Handler Endpoint (Optional)

**CRITICAL:** Only create this endpoint if specified in the intent's `endpoints` array.

**File location:** `app/api/email/webhook/route.ts`

Resend can send webhooks for email events (delivered, opened, clicked, bounced, etc.).

Create `app/api/email/webhook/route.ts`:

```typescript
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
    const headersList = headers();

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
        // Update your database: mark email as sent
        break;

      case "email.delivered":
        // Email was successfully delivered to the recipient
        console.log(`Email delivered: ${data.email_id}`);
        // Update your database: mark email as delivered
        break;

      case "email.delivery_delayed":
        // Email delivery was delayed (temporary issue)
        console.log(`Email delivery delayed: ${data.email_id}`);
        // Update your database: mark email as delayed
        break;

      case "email.bounced":
        // Email bounced (hard or soft bounce)
        console.log(`Email bounced: ${data.email_id}`, {
          reason: data.bounce?.reason,
          type: data.bounce?.type // 'hard' or 'soft'
        });
        // Update your database: mark email as bounced
        // For hard bounces, consider removing email from your list
        break;

      case "email.complained":
        // Recipient marked email as spam
        console.log(`Email complained: ${data.email_id}`);
        // Update your database: mark recipient as unsubscribed
        // Remove recipient from future emails
        break;

      case "email.opened":
        // Recipient opened the email
        console.log(`Email opened: ${data.email_id}`);
        // Update your database: track email open
        // This is useful for engagement metrics
        break;

      case "email.clicked":
        // Recipient clicked a link in the email
        console.log(`Email link clicked: ${data.email_id}`, {
          link: data.click?.link
        });
        // Update your database: track link click
        // This is useful for conversion tracking
        break;

      default:
        console.log(`Unknown webhook event type: ${type}`);
    }

    // Always return 200 OK to acknowledge receipt
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error("Error processing webhook:", error);

    // Return 200 OK even on error to prevent retries
    // Log errors for investigation
    return NextResponse.json({ received: true, error: "Processing failed" }, { status: 200 });
  }
}
```

**Webhook Features:**

- **Event handling** for all Resend webhook events
- **Signature verification** (optional but recommended for production)
- **Comprehensive logging** for debugging
- **Database updates** for email tracking (implement as needed)
- **Graceful error handling** to prevent webhook retries

### Step 7: Create React Email Templates (Optional but Recommended)

For production-quality emails, use React Email templates.

**File location:** `emails/welcome.tsx`

Create `emails/welcome.tsx`:

```typescript
import { Html, Head, Body, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface WelcomeEmailProps {
  name: string;
  loginUrl: string;
}

export default function WelcomeEmail({ name, loginUrl }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Welcome to Our App!</Heading>

          <Text style={text}>Hi {name},</Text>

          <Text style={text}>
            Thank you for signing up! We're excited to have you on board. Get started by logging into your account:
          </Text>

          <Button href={loginUrl} style={button}>
            Get Started
          </Button>

          <Hr style={hr} />

          <Text style={footer}>
            If you have any questions, feel free to reply to this email.
            <br />
            <br />
            Best regards,
            <br />
            The Team
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

// Styles
const main = {
  backgroundColor: "#f6f9fc",
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif'
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "20px 0 48px",
  marginBottom: "64px",
  maxWidth: "600px"
};

const h1 = {
  color: "#2563eb",
  fontSize: "32px",
  fontWeight: "bold",
  margin: "40px 0",
  padding: "0",
  textAlign: "center" as const
};

const text = {
  color: "#333",
  fontSize: "16px",
  lineHeight: "26px",
  margin: "16px 0"
};

const button = {
  backgroundColor: "#2563eb",
  borderRadius: "6px",
  color: "#fff",
  fontSize: "16px",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "12px 24px",
  margin: "24px 0"
};

const hr = {
  borderColor: "#e6ebf1",
  margin: "32px 0"
};

const footer = {
  color: "#8898aa",
  fontSize: "14px",
  lineHeight: "24px"
};
```

**Using React Email Templates:**

```typescript
import { render } from "@react-email/render";
import WelcomeEmail from "@/emails/welcome";

// In your email sending code:
const emailHtml = render(WelcomeEmail({ name: "John", loginUrl: "https://app.com/login" }));

await sendEmail({
  to: "user@example.com",
  subject: "Welcome!",
  html: emailHtml
});

// Or use the react prop directly (Resend supports this):
await sendEmail({
  to: "user@example.com",
  subject: "Welcome!",
  react: <WelcomeEmail name="John" loginUrl="https://app.com/login" />
});
```

### Step 8: Create Type Definitions

**File location:** `types/email.ts` (based on `paths.types` from `project.yaml`)

Create `types/email.ts`:

```typescript
/**
 * Email-related type definitions
 */

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailSendRequest {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  tags?: EmailTag[];
  scheduledAt?: string;
}

export interface EmailTag {
  name: string;
  value: string;
}

export interface EmailSendResponse {
  success: boolean;
  data?: {
    id: string;
    message: string;
  };
  error?: string;
}

export interface BatchEmailRequest {
  emails: Array<{
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    from?: string;
    replyTo?: string;
  }>;
}

export interface BatchEmailResponse {
  success: boolean;
  data?: {
    ids: string[];
    message: string;
  };
  error?: string;
}

export interface WebhookEvent {
  type:
    | "email.sent"
    | "email.delivered"
    | "email.delivery_delayed"
    | "email.bounced"
    | "email.complained"
    | "email.opened"
    | "email.clicked";
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    bounce?: {
      reason: string;
      type: "hard" | "soft";
    };
    click?: {
      link: string;
      ipAddress?: string;
      userAgent?: string;
    };
  };
}
```

## Configuration

### Environment Variables

Set the following environment variables in `.env.local`:

```bash
# Required
RESEND_API_KEY=re_your_api_key_here

# Optional (can also be set in code)
FROM_EMAIL=noreply@yourdomain.com
FROM_NAME="Your App Name"

# Optional: For webhook signature verification
RESEND_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

**Getting Your API Key:**

1. Sign up at [resend.com](https://resend.com)
2. Go to [API Keys](https://resend.com/api-keys)
3. Create a new API key
4. Copy the key and add to `.env.local`

**Verifying Your Domain:**

For production use, you must verify your sending domain:

1. Go to [Domains](https://resend.com/domains) in Resend Dashboard
2. Add your domain (e.g., `yourdomain.com`)
3. Add the required DNS records (MX, TXT, CNAME)
4. Wait for verification (usually a few minutes)
5. Update `FROM_EMAIL` to use your verified domain

### Intent Configuration Options

The `config` object in the intent supports:

- `api_key`: Resend API key (use `env:RESEND_API_KEY` format)
- `from_email`: Default sender email address (must be verified)
- `from_name`: Default sender name
- `reply_to`: Default reply-to email address

## Testing

### Send a Test Email

```bash
curl -X POST http://localhost:3000/api/email/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Test Email",
    "html": "<h1>Hello World!</h1><p>This is a test email from Resend.</p>"
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "id": "abc123-def456-ghi789",
    "message": "Email sent successfully"
  }
}
```

### Send Email with Schedule

Schedule an email to be sent in 1 hour:

```bash
curl -X POST http://localhost:3000/api/email/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Scheduled Email",
    "html": "<p>This email was scheduled</p>",
    "scheduledAt": "2025-11-18T15:00:00Z"
  }'
```

### Send Batch Emails

```bash
curl -X POST http://localhost:3000/api/email/batch \
  -H "Content-Type: application/json" \
  -d '{
    "emails": [
      {
        "to": "user1@example.com",
        "subject": "Welcome User 1",
        "html": "<p>Welcome to our app, User 1!</p>"
      },
      {
        "to": "user2@example.com",
        "subject": "Welcome User 2",
        "html": "<p>Welcome to our app, User 2!</p>"
      }
    ]
  }'
```

### Test Webhook Locally

Use [ngrok](https://ngrok.com) or similar tool to expose your local server:

```bash
# Install ngrok
npm install -g ngrok

# Expose local server
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
# Add webhook in Resend Dashboard:
# URL: https://abc123.ngrok.io/api/email/webhook
```

## Usage Examples

### Send Welcome Email

```typescript
import { sendEmail, EmailTemplates } from "@/lib/email";

// Using built-in template
await sendEmail({
  to: "newuser@example.com",
  subject: "Welcome to Our App!",
  html: EmailTemplates.welcome("John Doe", "https://app.com/login")
});

// Using React Email template
import WelcomeEmail from "@/emails/welcome";

await sendEmail({
  to: "newuser@example.com",
  subject: "Welcome to Our App!",
  react: <WelcomeEmail name="John Doe" loginUrl="https://app.com/login" />
});
```

### Send Password Reset Email

```typescript
import { sendEmail, EmailTemplates } from "@/lib/email";

await sendEmail({
  to: "user@example.com",
  subject: "Reset Your Password",
  html: EmailTemplates.passwordReset("John Doe", "https://app.com/reset?token=abc123", "1 hour"),
  tags: [{ name: "category", value: "password-reset" }]
});
```

### Send Notification with Action Button

```typescript
import { sendEmail, EmailTemplates } from "@/lib/email";

await sendEmail({
  to: "user@example.com",
  subject: "New Comment on Your Post",
  html: EmailTemplates.notification(
    "New Comment",
    "Someone commented on your post 'My First Post'",
    "https://app.com/posts/123#comments",
    "View Comment"
  ),
  tags: [
    { name: "category", value: "notification" },
    { name: "type", value: "comment" }
  ]
});
```

### Send Scheduled Email

```typescript
import { sendEmail } from "@/lib/email";

// Send email tomorrow at 9 AM
const tomorrow9AM = new Date();
tomorrow9AM.setDate(tomorrow9AM.getDate() + 1);
tomorrow9AM.setHours(9, 0, 0, 0);

await sendEmail({
  to: "user@example.com",
  subject: "Scheduled Reminder",
  html: "<p>This is your scheduled reminder</p>",
  scheduledAt: tomorrow9AM.toISOString()
});
```

### Send Batch Emails with Different Content

```typescript
import { sendBatchEmails } from "@/lib/email";

const users = [
  { email: "user1@example.com", name: "User 1" },
  { email: "user2@example.com", name: "User 2" },
  { email: "user3@example.com", name: "User 3" }
];

await sendBatchEmails({
  emails: users.map(user => ({
    to: user.email,
    subject: `Welcome ${user.name}!`,
    html: `<h1>Welcome ${user.name}!</h1><p>Thanks for joining us.</p>`
  }))
});
```

## Best Practices

1. **Domain Verification**: Always verify your sending domain in production
2. **Rate Limiting**: Implement rate limiting on email endpoints to prevent abuse
3. **Email Validation**: Validate email addresses before sending
4. **Unsubscribe Links**: Include unsubscribe links in marketing emails (legal requirement)
5. **Error Handling**: Log all email errors for debugging
6. **Webhook Security**: Verify webhook signatures in production
7. **Email Templates**: Use React Email for maintainable, beautiful emails
8. **Testing**: Test emails in development using [Resend's test mode](https://resend.com/docs/dashboard/testing)
9. **Monitoring**: Monitor email delivery rates and bounce rates
10. **Compliance**: Follow CAN-SPAM, GDPR, and other email regulations
11. **TypeScript Types**: Avoid using `any` type - use conditional object construction and proper type narrowing as shown in the implementation guide

## Troubleshooting

### "RESEND_API_KEY is required" error

- Ensure `RESEND_API_KEY` is set in `.env.local`
- Restart Next.js dev server after adding the variable
- Verify the API key is valid in Resend Dashboard

### "Domain not verified" error

- Verify your domain in [Resend Dashboard → Domains](https://resend.com/domains)
- Add required DNS records (MX, TXT, CNAME)
- Wait for DNS propagation (usually 15-60 minutes)
- In development, you can send from `onboarding@resend.dev` (100 emails/day limit)

### Emails not being delivered

- Check [Resend Logs](https://resend.com/emails) for delivery status
- Verify recipient email address is valid
- Check spam folder
- Review bounce/complaint rates
- Ensure SPF, DKIM, DMARC records are configured correctly

### Webhooks not being received

- Verify webhook URL is publicly accessible (use ngrok for local testing)
- Check webhook endpoint logs for errors
- Verify webhook is configured in [Resend Dashboard → Webhooks](https://resend.com/webhooks)
- Test webhook manually using Resend's "Send test" button
- Ensure endpoint returns 200 OK status

### React Email templates not rendering

- Install required packages: `@react-email/components` and `@react-email/render`
- Import render function: `import { render } from "@react-email/render"`
- Ensure React Email components are properly imported
- Check for TypeScript errors in email components

### TypeScript linter errors

If you encounter TypeScript errors:

- **"Unexpected any" error**: Use the conditional object construction pattern shown in the guide instead of `const emailData: any = {}`
- **"This expression is not callable" error**: Ensure proper type handling for `result.data` with `Array.isArray()` checks and type narrowing
- **"Parameter implicitly has 'any' type" error**: Add explicit type annotations like `(item: { id?: string })` when mapping arrays
- Follow the exact patterns shown in Step 3 of this guide to avoid all linter errors

## Security Considerations

1. **API Key Protection**: Never expose API keys in client-side code
2. **Rate Limiting**: Implement rate limiting to prevent email bombing
3. **Input Validation**: Validate all email inputs (to, from, subject, content)
4. **Webhook Verification**: Verify webhook signatures using Resend's signing secret
5. **Content Sanitization**: Sanitize HTML content to prevent XSS attacks
6. **Authentication**: Protect email endpoints with authentication
7. **Logging**: Log email sends for audit trails (but don't log email content)
8. **CORS**: Configure CORS properly if sending emails from frontend

## Next Steps

After implementing email capability:

1. Create additional React Email templates for your use cases
2. Set up email tracking and analytics
3. Implement email preferences and unsubscribe functionality
4. Add email queue for high-volume sending
5. Set up monitoring and alerts for email failures
6. Implement A/B testing for email campaigns
7. Add email templates for all user journeys

## Resources

- [Resend Documentation](https://resend.com/docs)
- [Resend API Reference](https://resend.com/docs/api-reference)
- [React Email Documentation](https://react.email/docs)
- [React Email Examples](https://react.email/examples)
- [Email Best Practices](https://resend.com/docs/knowledge-base/best-practices)
- [Webhook Events](https://resend.com/docs/dashboard/webhooks/event-types)

## Differences from Auth Capability

- **No Middleware Required**: Email capability doesn't need middleware
- **External Service**: Uses Resend API instead of local authentication
- **Async Operations**: Email sending is asynchronous and may be delayed
- **Webhook Handling**: Requires webhook endpoint for email events
- **Domain Verification**: Requires DNS configuration for production use
- **Templates**: Supports both HTML strings and React components
