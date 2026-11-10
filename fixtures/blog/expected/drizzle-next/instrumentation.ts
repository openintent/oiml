// Created once by OSL (@osl/backend-drizzle-next). Runs when the Next.js server starts.
// You own this file: OSL never rewrites it.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Sealed fields: the server does not start without OSL_SEAL_KEY, or with one that is not a key.
    const { sealKey } = await import("./generated/seal");
    sealKey();
    // Queued events run in this process unless OSL_ROLE=web (then run src/worker.ts separately).
    const { startWorker } = await import("./generated/jobs");
    await startWorker();
  }
}
