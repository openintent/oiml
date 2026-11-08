/**
 * Email type definitions for the Resend email capability
 *
 * These types provide type safety for email operations and webhook events
 */

/**
 * Email sending request structure
 */
export interface SendEmailRequest {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  tags?: Array<{ name: string; value: string }>;
  scheduledAt?: string; // ISO 8601 format
}

/**
 * Batch email request structure
 */
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

/**
 * Email sending response structure
 */
export interface SendEmailResponse {
  success: boolean;
  data?: {
    id: string;
    message: string;
  };
  error?: string;
}

/**
 * Batch email response structure
 */
export interface BatchEmailResponse {
  success: boolean;
  data?: {
    ids: string[];
    message: string;
  };
  error?: string;
}

/**
 * Resend webhook event types
 */
export type ResendWebhookEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.bounced"
  | "email.complained"
  | "email.opened"
  | "email.clicked";

/**
 * Resend webhook event structure
 */
export interface ResendWebhookEvent {
  type: ResendWebhookEventType;
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
      timestamp: string;
    };
  };
}

/**
 * Email status (for tracking in database)
 */
export type EmailStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "delayed"
  | "bounced"
  | "complained"
  | "opened"
  | "clicked";

/**
 * Email record structure (for database storage)
 */
export interface EmailRecord {
  id: string;
  email_id: string; // Resend email ID
  to: string[];
  from: string;
  subject: string;
  status: EmailStatus;
  created_at: Date;
  sent_at?: Date;
  delivered_at?: Date;
  opened_at?: Date;
  clicked_at?: Date;
  bounced_at?: Date;
  bounce_reason?: string;
  tags?: Record<string, string>;
}
