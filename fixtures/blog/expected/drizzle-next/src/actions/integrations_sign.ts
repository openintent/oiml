// Created once by OSL (@osl/backend-drizzle-next). Sign a payload with the integration's secret (HMAC-SHA256, in hexadecimal). POST /api/integrations/{id}/sign: ctx.row is the Integration; return the row to answer with it.
// You own this file: OSL never rewrites it.

import type { ActionContext } from "@/generated/actions";
import type { Integration } from "@/generated/db/schema";
import type { IntegrationsSignInput } from "@/generated/validation";

// Throw an error from "@/generated/http" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<IntegrationsSignInput, Integration>): Promise<{ signature: string }> {
  void ctx;
  return { signature: "" };
}
