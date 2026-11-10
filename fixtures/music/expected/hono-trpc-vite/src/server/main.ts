// Created once by OSL (@osl/backend-hono-trpc-vite). The API process. Add middleware or routes to the app here, or in generated/server/app.ts's caller.
// You own this file: OSL never rewrites it.

import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";

// Variables from .env must be in place before the app loads: the database pool reads DATABASE_URL
// when its module is first imported, so the import below stays dynamic. Ones already in the
// environment win over the file.
if (existsSync(".env")) process.loadEnvFile(".env");

const { createApp, startBackground } = await import("@generated/server/app");

const port = Number(process.env.PORT ?? 3111);
const app = createApp();

serve({ fetch: app.fetch, port }, info => {
  console.log(`API listening on http://localhost:${info.port}`);
});
// Queued events run in this process too unless OSL_ROLE=web (then run src/server/worker.ts separately).
void startBackground();
