import { Resend } from "resend";

// Initialize Resend client
// API key comes from environment variable (configured in intent)
if (!process.env.RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY environment variable is required");
}

export const resend = new Resend(process.env.RESEND_API_KEY);

// Default sender configuration from intent config
export const DEFAULT_FROM = {
  email: process.env.FROM_EMAIL || "noreply@mail.oiml.dev",
  name: process.env.FROM_NAME || "OIML"
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

    // Extract IDs from result
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
