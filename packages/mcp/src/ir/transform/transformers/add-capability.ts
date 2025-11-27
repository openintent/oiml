/**
 * Transformer for add_capability intent to AddCapabilityIRV1
 * Version: 1.0.0
 */

import { z } from "zod";
// @ts-expect-error - schema.zod.js is a JavaScript file with Zod runtime types
import { AddCapability } from "@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js";
import { AddCapabilityIRV1 } from "../../intents/add-capability.js";
import type { AddCapabilityIRV1 as AddCapabilityIRV1Type } from "../../intents/add-capability.js";
import type { CapabilityOverlay } from "../../intents/add-capability.js";
import { TransformContext, DiagnosticCollector } from "../types.js";

/** Type alias for the add_capability intent input */
export type AddCapabilityIntent = z.infer<typeof AddCapability>;

/**
 * Build email capability overlay with defaults
 */
function buildEmailOverlay(intent: AddCapabilityIntent, diagnostics: DiagnosticCollector): CapabilityOverlay {
  const overlay: any = {
    type: "email"
  };

  // Infer default sender from config
  if (intent.config?.from_email) {
    overlay.from = {
      email: intent.config.from_email,
      name: intent.config.from_name || "Your App"
    };
    diagnostics.info("CAP001", "Configured default sender from intent config", "$.config.from_email");
  } else {
    diagnostics.info("CAP001", "No default sender configured - using environment defaults", "$.config");
  }

  // Infer webhook configuration from endpoints
  const webhookEndpoint = intent.endpoints?.find((e: any) => e.path?.includes("webhook"));
  if (webhookEndpoint) {
    overlay.webhooks = {
      events: [
        "email.sent",
        "email.delivered",
        "email.bounced",
        "email.opened",
        "email.clicked",
        "email.complained",
        "email.delivery_delayed"
      ],
      endpoint: webhookEndpoint.path,
      verifySignature: true
    };
    diagnostics.info("CAP002", "Inferred webhook configuration from endpoint", "$.endpoints");
  }

  // Add SMTP configuration if provider is not Resend
  if (intent.provider && intent.provider !== "resend") {
    diagnostics.info(
      "CAP003",
      `Custom provider '${intent.provider}' detected - SMTP configuration may be needed`,
      "$.provider"
    );
  }

  return overlay as CapabilityOverlay;
}

/**
 * Build storage capability overlay with defaults
 */
function buildStorageOverlay(intent: AddCapabilityIntent, diagnostics: DiagnosticCollector): CapabilityOverlay {
  const overlay: any = {
    type: "storage",
    buckets: []
  };

  // Extract bucket configuration from intent
  if ((intent as any).buckets && Array.isArray((intent as any).buckets)) {
    overlay.buckets = (intent as any).buckets.map((bucket: any) => ({
      name: bucket.name,
      public: bucket.public !== false,
      fileSizeLimit: bucket.file_size_limit || bucket.fileSizeLimit,
      allowedMimeTypes: bucket.allowed_mime_types || bucket.allowedMimeTypes,
      cacheControl: bucket.cache_control || bucket.cacheControl || "3600"
    }));

    diagnostics.info("CAP004", `Configured ${overlay.buckets.length} storage bucket(s)`, "$.buckets");
  } else {
    diagnostics.warn("CAP005", "No buckets configured - you'll need to create them manually", "$.buckets");
  }

  // Infer image transformation settings for Supabase
  if (intent.provider === "supabase") {
    overlay.imageTransformations = {
      enabled: true,
      formats: ["webp", "avif", "jpeg", "png"],
      quality: {
        default: 80,
        min: 50,
        max: 100
      }
    };
    diagnostics.info("CAP006", "Enabled image transformations for Supabase provider", "$.provider");
  }

  // Add CDN configuration hint
  if (intent.provider === "supabase") {
    overlay.cdn = {
      enabled: true
    };
    diagnostics.info("CAP007", "Supabase Storage includes built-in CDN", "$.provider");
  }

  return overlay as CapabilityOverlay;
}

/**
 * Build auth capability overlay with defaults
 */
function buildAuthOverlay(intent: AddCapabilityIntent, diagnostics: DiagnosticCollector): CapabilityOverlay {
  const overlay: any = {
    type: "auth",
    strategies: ["jwt"] // Default to JWT
  };

  // Infer strategies from config
  if (intent.config?.strategies) {
    overlay.strategies = intent.config.strategies;
    diagnostics.info("CAP008", `Configured auth strategies: ${overlay.strategies.join(", ")}`, "$.config.strategies");
  } else {
    diagnostics.info("CAP008", "Using default JWT authentication strategy", "$.config");
  }

  // Add session configuration defaults
  overlay.session = {
    duration: 86400, // 24 hours default
    storage: "cookie",
    cookie: {
      name: "session",
      httpOnly: true,
      secure: true,
      sameSite: "lax"
    }
  };
  diagnostics.info("CAP009", "Using default session configuration (24h, cookie-based)", "$.config");

  // Add password requirements defaults
  overlay.password = {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: false
  };
  diagnostics.info("CAP010", "Using default password requirements", "$.config");

  return overlay as CapabilityOverlay;
}

/**
 * Build billing capability overlay with defaults
 */
function buildBillingOverlay(intent: AddCapabilityIntent, diagnostics: DiagnosticCollector): CapabilityOverlay {
  const overlay: any = {
    type: "billing",
    provider: intent.provider || "stripe",
    plans: []
  };

  // Extract pricing plans from config
  if ((intent as any).plans && Array.isArray((intent as any).plans)) {
    overlay.plans = (intent as any).plans;
    diagnostics.info("CAP011", `Configured ${overlay.plans.length} pricing plan(s)`, "$.plans");
  } else {
    diagnostics.warn("CAP012", "No pricing plans configured", "$.plans");
  }

  // Infer webhook configuration
  const webhookEndpoint = intent.endpoints?.find((e: any) => e.path?.includes("webhook"));
  if (webhookEndpoint) {
    overlay.webhooks = {
      events: [
        "payment.succeeded",
        "payment.failed",
        "subscription.created",
        "subscription.updated",
        "subscription.canceled"
      ],
      endpoint: webhookEndpoint.path
    };
    diagnostics.info("CAP013", "Inferred webhook configuration for billing events", "$.endpoints");
  }

  return overlay as CapabilityOverlay;
}

/**
 * Build file upload capability overlay with defaults
 */
function buildFileUploadOverlay(intent: AddCapabilityIntent, diagnostics: DiagnosticCollector): CapabilityOverlay {
  const overlay: any = {
    type: "file_upload",
    maxFileSize: (intent.config as any)?.max_file_size || 10485760, // 10MB default
    allowedTypes: (intent.config as any)?.allowed_types || ["*/*"],
    destination: (intent.config as any)?.destination || "local"
  };

  diagnostics.info("CAP014", `File upload destination: ${overlay.destination}`, "$.config.destination");

  // Add virus scanning recommendation for production
  overlay.virusScanning = {
    enabled: false
  };
  diagnostics.info("CAP015", "Virus scanning disabled by default - enable for production", "$.config");

  return overlay as CapabilityOverlay;
}

/**
 * Transform an add_capability intent to IR
 *
 * @param intent - The parsed add_capability intent
 * @param context - Transformation context
 * @returns Validated AddCapabilityIRV1 IR
 */
export function transformAddCapability(intent: AddCapabilityIntent, context: TransformContext): AddCapabilityIRV1Type {
  const diagnostics = new DiagnosticCollector();

  // Transform endpoints if provided
  const endpoints: any[] = [];
  if (intent.endpoints) {
    for (const endpoint of intent.endpoints) {
      const endpointIR: any = {};

      if (endpoint.method) {
        endpointIR.method = endpoint.method;
      }

      if (endpoint.path) {
        endpointIR.path = endpoint.path;
      }

      if (endpoint.group) {
        endpointIR.group = endpoint.group;
      }

      if (endpoint.description) {
        endpointIR.description = endpoint.description;
      }

      endpoints.push(endpointIR);
    }
  }

  // Build capability IR
  const capability: any = {
    type: intent.capability,
    framework: intent.framework
  };

  if (intent.provider) {
    capability.provider = intent.provider;
  }

  if (intent.config) {
    capability.config = intent.config;
  }

  if (endpoints.length > 0) {
    capability.endpoints = endpoints;
  }

  // Build capability-specific overlay
  let overlay: CapabilityOverlay | undefined;

  switch (intent.capability) {
    case "email":
      overlay = buildEmailOverlay(intent, diagnostics);
      break;

    case "storage":
      overlay = buildStorageOverlay(intent, diagnostics);
      break;

    case "auth":
      overlay = buildAuthOverlay(intent, diagnostics);
      break;

    case "billing":
      overlay = buildBillingOverlay(intent, diagnostics);
      break;

    case "file_upload":
      overlay = buildFileUploadOverlay(intent, diagnostics);
      break;

    default:
      diagnostics.info("CAP100", `No overlay builder for capability type '${intent.capability}'`, "$.capability");
      break;
  }

  if (overlay) {
    capability.overlay = overlay;
    diagnostics.info("CAP000", `Built ${intent.capability} capability overlay with defaults`, "$.capability");
  }

  // Build the IR
  const ir: AddCapabilityIRV1Type = {
    kind: "AddCapability",
    irVersion: "1.0.0",
    provenance: {
      intentId: context.intentId,
      projectId: context.projectId,
      generatedAt: new Date().toISOString(),
      sourceIntentVersion: context.oimlVersion,
      model: context.model
    },
    capability,
    diagnostics: diagnostics.getDiagnostics()
  };

  // Validate the IR with Zod
  const validationResult = AddCapabilityIRV1.safeParse(ir);

  if (!validationResult.success) {
    validationResult.error.issues.forEach(issue => {
      diagnostics.error("IR099", `IR validation failed: ${issue.message}`, issue.path.join("."));
    });

    if (diagnostics.hasErrors()) {
      const error = new Error("IR transformation failed with validation errors");
      (error as any).diagnostics = diagnostics.getDiagnostics();
      throw error;
    }
  }

  return validationResult.success ? validationResult.data : ir;
}
