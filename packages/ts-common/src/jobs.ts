import type { IR } from "@osl/core";
import type { ServerConventions } from "./server-conventions.js";

export const JOBS_DEPENDENCIES = { "pg-boss": "^12" };

/** generated/jobs.ts: a Postgres-backed queue (pg-boss) for events delivered through it. */
export function jobsFile(ir: IR, conv: ServerConventions): string {
  void ir;
  return `${conv.header("Background jobs on pg-boss: queued events are stored in Postgres and run by the worker with retries.")}
import { PgBoss } from "pg-boss";
import { QUEUED_EVENTS, runQueued } from "./events";

export type Role = "web" | "worker" | "all";

/** OSL_ROLE: web only answers requests and enqueues; worker only runs jobs; all (default) does both in one process. */
export function role(): Role {
  const value = process.env.OSL_ROLE;
  return value === "web" || value === "worker" ? value : "all";
}

const globalForJobs = globalThis as unknown as { oslBoss?: Promise<PgBoss> };

/** The started queue, created once per process (and kept across reloads in development). */
export function getBoss(): Promise<PgBoss> {
  globalForJobs.oslBoss ??= (async () => {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: "pgboss" });
    boss.on("error", error => console.error("[jobs]", error));
    await boss.start();
    for (const name of QUEUED_EVENTS) {
      if (!(await boss.getQueue(name))) await boss.createQueue(name, { retryLimit: 3, retryDelay: 2, retryBackoff: true });
    }
    return boss;
  })();
  return globalForJobs.oslBoss;
}

export async function enqueue(name: string, payload: unknown): Promise<void> {
  const boss = await getBoss();
  await boss.send(name, (payload ?? {}) as object);
}

/** Run queued events in this process; a no-op in the web role. */
export async function startWorker(): Promise<void> {
  if (role() === "web") return;
  const boss = await getBoss();
  for (const name of QUEUED_EVENTS) {
    await boss.work(name, async jobs => {
      for (const job of jobs) await runQueued(name, job.data);
    });
  }
}

export async function stopJobs(): Promise<void> {
  if (!globalForJobs.oslBoss) return;
  const boss = await globalForJobs.oslBoss;
  await boss.stop({ graceful: true });
  delete globalForJobs.oslBoss;
}
`;
}
