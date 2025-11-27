/**
 * IR envelope for an `add_capability` intent.
 * Version: 1.0.0
 */

import { z } from "zod";
import { DiagnosticIR, ProvenanceIR } from "../common.js";

/**
 * Endpoint configuration for a capability
 */
export const CapabilityEndpointIR = z
  .object({
    /** HTTP method (if specific endpoint) */
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
    /** Path (if specific endpoint) */
    path: z.string().regex(/^\//, "must start with '/'").optional(),
    /** Route group (if applying to a group) */
    group: z.string().optional(),
    /** Description */
    description: z.string().optional()
  })
  .strict();

export type CapabilityEndpointIR = z.infer<typeof CapabilityEndpointIR>;

/**
 * Email capability overlay - specific configuration for email capabilities
 */
export const EmailCapabilityOverlay = z
  .object({
    /** Type discriminator */
    type: z.literal("email"),
    /** Email templates */
    templates: z
      .array(
        z.object({
          /** Template name (e.g., "welcome", "password-reset") */
          name: z.string(),
          /** Subject line */
          subject: z.string(),
          /** Template format */
          format: z.enum(["html", "text", "react"]),
          /** Template path or content */
          source: z.string()
        })
      )
      .optional(),
    /** SMTP configuration (if applicable) */
    smtp: z
      .object({
        host: z.string(),
        port: z.number(),
        secure: z.boolean().optional(),
        auth: z
          .object({
            user: z.string(),
            pass: z.string()
          })
          .optional()
      })
      .optional(),
    /** Webhook configuration */
    webhooks: z
      .object({
        /** Webhook events to subscribe to */
        events: z.array(z.string()),
        /** Webhook endpoint path */
        endpoint: z.string(),
        /** Signature verification */
        verifySignature: z.boolean().optional()
      })
      .optional(),
    /** Default sender configuration */
    from: z
      .object({
        email: z.string().email(),
        name: z.string().optional()
      })
      .optional()
  })
  .strict();

export type EmailCapabilityOverlay = z.infer<typeof EmailCapabilityOverlay>;

/**
 * Storage capability overlay - specific configuration for storage capabilities
 */
export const StorageCapabilityOverlay = z
  .object({
    /** Type discriminator */
    type: z.literal("storage"),
    /** Bucket configurations */
    buckets: z.array(
      z.object({
        /** Bucket name */
        name: z.string(),
        /** Public or private access */
        public: z.boolean(),
        /** File size limit in bytes */
        fileSizeLimit: z.number().optional(),
        /** Allowed MIME types */
        allowedMimeTypes: z.array(z.string()).optional(),
        /** Cache control header */
        cacheControl: z.string().optional()
      })
    ),
    /** Image transformation settings */
    imageTransformations: z
      .object({
        /** Enable image transformations */
        enabled: z.boolean(),
        /** Supported formats */
        formats: z.array(z.enum(["webp", "avif", "jpeg", "png"])).optional(),
        /** Quality settings */
        quality: z
          .object({
            default: z.number().min(1).max(100).optional(),
            min: z.number().min(1).max(100).optional(),
            max: z.number().min(1).max(100).optional()
          })
          .optional()
      })
      .optional(),
    /** CDN configuration */
    cdn: z
      .object({
        /** Enable CDN */
        enabled: z.boolean(),
        /** Custom domain */
        customDomain: z.string().optional()
      })
      .optional()
  })
  .strict();

export type StorageCapabilityOverlay = z.infer<typeof StorageCapabilityOverlay>;

/**
 * Auth capability overlay - specific configuration for authentication capabilities
 */
export const AuthCapabilityOverlay = z
  .object({
    /** Type discriminator */
    type: z.literal("auth"),
    /** Authentication strategies */
    strategies: z.array(z.enum(["jwt", "session", "oauth", "magic-link", "passwordless"])),
    /** Session configuration */
    session: z
      .object({
        /** Session duration in seconds */
        duration: z.number(),
        /** Session storage */
        storage: z.enum(["cookie", "localStorage", "database"]),
        /** Cookie settings */
        cookie: z
          .object({
            name: z.string(),
            httpOnly: z.boolean().optional(),
            secure: z.boolean().optional(),
            sameSite: z.enum(["strict", "lax", "none"]).optional()
          })
          .optional()
      })
      .optional(),
    /** OAuth providers */
    oauthProviders: z
      .array(
        z.object({
          /** Provider name */
          provider: z.enum(["google", "github", "facebook", "twitter", "apple"]),
          /** Client ID */
          clientId: z.string(),
          /** Client secret */
          clientSecret: z.string(),
          /** Scopes */
          scopes: z.array(z.string()).optional()
        })
      )
      .optional(),
    /** Password requirements */
    password: z
      .object({
        /** Minimum length */
        minLength: z.number().optional(),
        /** Require uppercase */
        requireUppercase: z.boolean().optional(),
        /** Require lowercase */
        requireLowercase: z.boolean().optional(),
        /** Require numbers */
        requireNumbers: z.boolean().optional(),
        /** Require special characters */
        requireSpecialChars: z.boolean().optional()
      })
      .optional()
  })
  .strict();

export type AuthCapabilityOverlay = z.infer<typeof AuthCapabilityOverlay>;

/**
 * Billing capability overlay - specific configuration for billing/payment capabilities
 */
export const BillingCapabilityOverlay = z
  .object({
    /** Type discriminator */
    type: z.literal("billing"),
    /** Payment provider */
    provider: z.enum(["stripe", "paypal", "square", "braintree"]),
    /** Pricing plans */
    plans: z.array(
      z.object({
        /** Plan ID */
        id: z.string(),
        /** Plan name */
        name: z.string(),
        /** Price in smallest currency unit (e.g., cents) */
        price: z.number(),
        /** Currency code */
        currency: z.string().length(3),
        /** Billing interval */
        interval: z.enum(["month", "year", "week", "day", "one-time"]),
        /** Features included */
        features: z.array(z.string()).optional()
      })
    ),
    /** Webhook events */
    webhooks: z
      .object({
        /** Events to handle */
        events: z.array(z.string()),
        /** Webhook endpoint */
        endpoint: z.string()
      })
      .optional(),
    /** Tax configuration */
    tax: z
      .object({
        /** Enable tax calculation */
        enabled: z.boolean(),
        /** Tax provider */
        provider: z.enum(["stripe", "taxjar", "avalara"]).optional()
      })
      .optional()
  })
  .strict();

export type BillingCapabilityOverlay = z.infer<typeof BillingCapabilityOverlay>;

/**
 * File upload capability overlay - specific configuration for file upload capabilities
 */
export const FileUploadCapabilityOverlay = z
  .object({
    /** Type discriminator */
    type: z.literal("file_upload"),
    /** Maximum file size in bytes */
    maxFileSize: z.number(),
    /** Allowed file types */
    allowedTypes: z.array(z.string()),
    /** Upload destination */
    destination: z.enum(["local", "s3", "gcs", "azure", "cloudinary"]),
    /** Destination configuration */
    destinationConfig: z.record(z.string(), z.any()).optional(),
    /** Enable resumable uploads */
    resumable: z.boolean().optional(),
    /** Virus scanning */
    virusScanning: z
      .object({
        enabled: z.boolean(),
        provider: z.string().optional()
      })
      .optional()
  })
  .strict();

export type FileUploadCapabilityOverlay = z.infer<typeof FileUploadCapabilityOverlay>;

/**
 * Discriminated union of all capability overlays
 */
export const CapabilityOverlay = z.discriminatedUnion("type", [
  EmailCapabilityOverlay,
  StorageCapabilityOverlay,
  AuthCapabilityOverlay,
  BillingCapabilityOverlay,
  FileUploadCapabilityOverlay
]);

export type CapabilityOverlay = z.infer<typeof CapabilityOverlay>;

/**
 * Resolved capability definition
 */
export const CapabilityIR = z
  .object({
    /** Type of capability */
    type: z.enum(["auth", "email", "storage", "billing", "file_upload", "file_stream", "sse", "websocket"]),
    /** Target framework */
    framework: z.string().min(1),
    /** Provider/library name */
    provider: z.string().optional(),
    /** Generic capability configuration (for backwards compatibility) */
    config: z.record(z.string(), z.any()).optional(),
    /** Endpoints to create or protect */
    endpoints: z.array(CapabilityEndpointIR).optional(),
    /** Capability-specific overlay with structured configuration */
    overlay: CapabilityOverlay.optional()
  })
  .strict();

export type CapabilityIR = z.infer<typeof CapabilityIR>;

/**
 * IR envelope for an `add_capability` intent.
 * Represents adding a capability module (auth, file upload, etc.).
 */
export const AddCapabilityIRV1 = z
  .object({
    /** Discriminator for this IR kind */
    kind: z.literal("AddCapability"),
    /** IR version */
    irVersion: z.literal("1.0.0"),
    /** Provenance tracking */
    provenance: ProvenanceIR,
    /** Capability configuration */
    capability: CapabilityIR,
    /** Non-fatal issues found during resolution */
    diagnostics: z.array(DiagnosticIR)
  })
  .strict();

export type AddCapabilityIRV1 = z.infer<typeof AddCapabilityIRV1>;
