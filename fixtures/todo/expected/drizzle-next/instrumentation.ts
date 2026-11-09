// Created once by OSL (@osl/backend-drizzle-next). Runs when the Next.js server starts.
// You own this file: OSL never rewrites it.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Queued events run in this process unless OSL_ROLE=web (then run src/worker.ts separately).
    const { startWorker } = await import("./generated/jobs");
    await startWorker();
  }
}
