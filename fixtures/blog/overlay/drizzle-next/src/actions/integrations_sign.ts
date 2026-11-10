// Fixture overlay: the user-owned handler the "integrations and sealed secrets" scenario relies on.
import { createHmac } from "node:crypto";
import type { ActionContext } from "@/generated/actions";
import type { Integration } from "@/generated/db/schema";
import { fail } from "@/generated/http";
import { unseal } from "@/generated/seal";
import type { IntegrationsSignInput } from "@/generated/validation";

/**
 * Signs the payload with the integration's secret. The row holds the secret as it is stored, sealed; this is the
 * one place that opens it, and the signature is all that leaves.
 */
export async function handler(ctx: ActionContext<IntegrationsSignInput, Integration>): Promise<{ signature: string }> {
  if (ctx.row.secret === null) fail(409, "conflict", "This integration has no secret");
  const secret = unseal("integrations.secret", ctx.row.secret);
  return { signature: createHmac("sha256", secret).update(ctx.input.payload).digest("hex") };
}
