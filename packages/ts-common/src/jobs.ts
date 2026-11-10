import type { IR } from "@osl/core";
import { isolationOf } from "./isolation.js";
import type { ServerConventions } from "./server-conventions.js";

export const JOBS_DEPENDENCIES = { "pg-boss": "^12" };

/** generated/jobs.ts: a Postgres-backed queue (pg-boss) for events delivered through it. */
export function jobsFile(ir: IR, conv: ServerConventions): string {
  const scheduling = ir.schedules.length > 0 || ir.timers.length > 0;
  // Under isolation: database a job acts as the system, through the owner's pool, and a job queued by a request is sent once its transaction commits
  const isolated = Boolean(isolationOf(ir));
  const system = (call: string) => (isolated ? `asSystem(() => ${call})` : call);
  const send = (call: string) => (isolated ? `await afterCommit(async () => {\n    ${call}\n  });` : call);
  return `${conv.header("Background jobs on pg-boss: queued events, schedules and timers are stored in Postgres and run by the worker with retries.")}
import { PgBoss } from "pg-boss";${isolated ? `\nimport { afterCommit, asSystem } from "./db/client";` : ""}
import { QUEUED_EVENTS, runQueued } from "./events";
${scheduling ? `import { SCHEDULES, TIMERS, runSchedule, runTimerJob } from "./scheduling";\n` : ""}
/** Every queue the app uses: one per queued event, schedule and timer */
function queueNames(): string[] {
  return [${scheduling ? `...QUEUED_EVENTS, ...SCHEDULES.map(s => "schedule." + s.name), ...TIMERS.map(t => "timer." + t.name)` : "...QUEUED_EVENTS"}];
}

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
    for (const name of queueNames()) {
      if (!(await boss.getQueue(name))) await boss.createQueue(name, { retryLimit: 3, retryDelay: 2, retryBackoff: true });
    }
    return boss;
  })();
  return globalForJobs.oslBoss;
}

export async function enqueue(name: string, payload: unknown): Promise<void> {
  const boss = await getBoss();
  ${send("await boss.send(name, (payload ?? {}) as object);")}
}

/** Store a job to run at a time; the same payload scheduled twice runs once */
export async function enqueueAt(name: string, payload: object, at: Date): Promise<void> {
  const boss = await getBoss();
  ${send("await boss.send(name, payload, { startAfter: at, singletonKey: JSON.stringify(payload) });")}
}

/** Run queued events in this process; a no-op in the web role. */
export async function startWorker(): Promise<void> {
  if (role() === "web") return;
  const boss = await getBoss();
  for (const name of QUEUED_EVENTS) {
    await boss.work(name, async jobs => {
      for (const job of jobs) await ${system("runQueued(name, job.data)")};
    });
  }${
    scheduling
      ? `
  for (const schedule of SCHEDULES) {
    const queue = "schedule." + schedule.name;
    await boss.schedule(queue, schedule.cron, {}, { tz: "UTC" });
    await boss.work(queue, async () => {
      await ${system("runSchedule(schedule.name, new Date())")};
    });
  }
  for (const timer of TIMERS) {
    await boss.work("timer." + timer.name, async jobs => {
      for (const job of jobs) await ${system("runTimerJob(timer.name, job.data as { id: unknown; due: string })")};
    });
  }`
      : ""
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
