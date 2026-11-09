// Created once by OSL (@osl/backend-hono-trpc-vite). A process that only runs queued events. The API runs them itself unless OSL_ROLE=web.
// You own this file: OSL never rewrites it.

import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.OSL_ROLE = "worker";

const { startWorker } = await import("@generated/jobs");
await startWorker();
console.log("worker running");
