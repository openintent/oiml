// Created once by OSL (@osl/backend-drizzle-next). A process that only runs queued events: tsx src/worker.ts
// You own this file: OSL never rewrites it.
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.OSL_ROLE = "worker";

const { startWorker } = await import("../generated/jobs");
await startWorker();
console.log("worker running");
