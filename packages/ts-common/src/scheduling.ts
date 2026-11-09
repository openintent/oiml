import type { IR, TimerIR } from "@osl/core";
import { entityByName, q, tableExport, typeName, type TsConventions } from "./conventions.js";

/** Whether the model has anything the queue runs on its own */
export function hasScheduling(ir: IR): boolean {
  return ir.schedules.length > 0 || ir.timers.length > 0;
}

/** The `holds(row)` predicate of a timer's when condition, or always true */
function holdsExpr(timer: TimerIR): string {
  if (!timer.when) return "() => true";
  const col = `row.${timer.when.column}`;
  if (timer.when.value === null) return `row => ${col} ${timer.when.op === "eq" ? "==" : "!="} null`;
  return `row => String(${col}) ${timer.when.op === "eq" ? "===" : "!=="} ${JSON.stringify(String(timer.when.value))}`;
}

/**
 * generated/scheduling.ts: the schedules and timers of the model, run as the system through the job queue, and
 * the functions the worker and the test hooks call.
 */
export function schedulingFile(ir: IR, conv: TsConventions): string {
  const timerDefs = ir.timers.map(timer => {
    const entity = entityByName(ir, timer.entity);
    const T = typeName(entity);
    const table = `schema.${tableExport(entity)}`;
    const pk = entity.primaryKey[0];
    const handler = `handlers.${timer.run.handler}`;
    return `const ${timer.name}: TimerDef<schema.${T}> = {
  name: ${q(timer.name)},
  entity: ${q(timer.entity)},
  dueOf: row => due(row.${timer.column}, ${timer.afterSeconds}),
  holds: ${holdsExpr(timer)},
  id: row => row.${pk},
  load: async id => (await db.select().from(${table}).where(eq(${table}.${pk}, id as schema.${T}[${q(pk)}])))[0],
  dueRows: now =>
    db
      .select()
      .from(${table})
      .where(and(isNotNull(${table}.${timer.column}), lte(${table}.${timer.column}, new Date(now.getTime() - ${timer.afterSeconds} * 1000)))),
  run: async (row, now) => {
    await ${handler}({ input: {} as Parameters<typeof ${handler}>[0]["input"], row, session: null, db, now });
  }
};`;
  });
  const scheduleRunners = ir.schedules.map(s => {
    const handler = `handlers.${s.run.handler}`;
    return `  ${s.name}: async (input, now) => {
    await ${handler}({ input: input as Parameters<typeof ${handler}>[0]["input"], row: undefined, session: null, db, now });
  }`;
  });
  return `${conv.header("Schedules and timers: work the queue runs as the system. The worker and the test hooks call these.")}
${ir.timers.length ? `import { and, eq, isNotNull, lte } from "drizzle-orm";\n` : ""}import { db } from "./db/client";
${ir.timers.length ? `import * as schema from "./db/schema";\n` : ""}import { handlers } from "./actions";
${ir.timers.length ? `import { enqueueAt } from "./jobs";\n` : ""}
/** A schedule: a cron (UTC) and the action it runs, with literal input */
export interface ScheduleDef {
  name: string;
  cron: string;
  /** The action in the step spelling: actions.<name> or <resource>.<action> */
  run: string;
  input: Record<string, unknown>;
}

export const SCHEDULES: ScheduleDef[] = [
${ir.schedules
  .map(
    s =>
      `  { name: ${q(s.name)}, cron: ${q(s.cron)}, run: ${q(s.run.resource ? `${s.run.resource}.${s.run.action}` : `actions.${s.run.action}`)}, input: ${JSON.stringify(s.input)} }`
  )
  .join(",\n")}
];

const SCHEDULE_RUNNERS: Record<string, (input: Record<string, unknown>, now: Date) => Promise<void>> = {
${scheduleRunners.join(",\n")}
};

/** Run a schedule's action now, as the system; false when no schedule has that name */
export async function runSchedule(name: string, now = new Date()): Promise<boolean> {
  const schedule = SCHEDULES.find(s => s.name === name);
  if (!schedule) return false;
  await SCHEDULE_RUNNERS[name](schedule.input, now);
  return true;
}

/** Run every schedule of an action (actions.send_digest, tasks.clear_done) now; the test hook */
export async function runSchedulesFor(run: string, now: Date): Promise<number> {
  let ran = 0;
  for (const schedule of SCHEDULES) {
    if (schedule.run !== run) continue;
    await runSchedule(schedule.name, now);
    ran++;
  }
  return ran;
}

/** The due time of a timer for a row: the field plus the offset, or null when the field is unset */
function due(at: Date | null | undefined, afterSeconds: number): Date | null {
  return at ? new Date(at.getTime() + afterSeconds * 1000) : null;
}

/** One timer: where its rows live, when they are due, and the action it runs for them */
interface TimerDef<Row> {
  name: string;
  entity: string;
  dueOf(row: Row): Date | null;
  holds(row: Row): boolean;
  id(row: Row): unknown;
  load(id: unknown): Promise<Row | undefined>;
  dueRows(now: Date): Promise<Row[]>;
  run(row: Row, now: Date): Promise<void>;
}
void due;

${timerDefs.join("\n\n")}

type AnyTimer = TimerDef<Record<string, unknown>>;
export const TIMERS: AnyTimer[] = [${ir.timers.map(t => `${t.name} as unknown as AnyTimer`).join(", ")}];

/** Schedule the timers of an entity for a row just written: one job per timer, due at the field plus the offset */
export async function scheduleTimers(entity: string, row: Record<string, unknown>): Promise<void> {
  for (const timer of TIMERS) {
    if (timer.entity !== entity) continue;
    const at = timer.dueOf(row);
    if (!at) continue;
    ${ir.timers.length ? `await enqueueAt(\`timer.\${timer.name}\`, { id: timer.id(row), due: at.toISOString() }, at);` : "void at;"}
  }
}

/** A timer job fired: run the action if the row still says so (same due time, condition holds) */
export async function runTimerJob(name: string, payload: { id: unknown; due: string }, now = new Date()): Promise<boolean> {
  const timer = TIMERS.find(t => t.name === name);
  if (!timer) return false;
  const row = await timer.load(payload.id);
  if (!row) return false;
  const at = timer.dueOf(row);
  if (!at || at.toISOString() !== payload.due || !timer.holds(row)) return false;
  await timer.run(row, now);
  return true;
}

/** Run every timer due at \`now\`, as the worker would have by then: the test hook and a manual sweep */
export async function runDueTimers(now: Date): Promise<number> {
  let ran = 0;
  for (const timer of TIMERS) {
    for (const row of await timer.dueRows(now)) {
      if (!timer.holds(row)) continue;
      await timer.run(row, now);
      ran++;
    }
  }
  return ran;
}
`;
}

/** The test hooks' shared logic: generated/test-hooks.ts, mounted by routes only when OSL_TEST_HOOKS=1 */
export function testHooksFile(ir: IR, conv: TsConventions, options: { email: boolean }): string {
  const scheduling = hasScheduling(ir);
  return `${conv.header("Test hooks: a clock for timers and schedules, and the captured mailbox. Routes mount these only when OSL_TEST_HOOKS=1.")}
${scheduling ? `import { runDueTimers, runSchedulesFor } from "./scheduling";\n` : ""}${options.email ? `import { captured } from "./email";\n` : ""}
/** Whether the hooks are on: never in production */
export function testHooksEnabled(): boolean {
  return process.env.OSL_TEST_HOOKS === "1";
}

/** The moment a hook runs at: the body's \`now\`, or the clock */
export function hookNow(body: unknown): Date {
  const raw = (body as { now?: unknown } | null)?.now;
  const parsed = typeof raw === "string" ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
}

/** POST /api/osl-hooks/timers/run { now } */
export async function timersRun(body: unknown): Promise<{ ran: number }> {
  ${scheduling ? "return { ran: await runDueTimers(hookNow(body)) };" : "void body;\n  return { ran: 0 };"}
}

/** POST /api/osl-hooks/schedules/run { run, now }; null when nothing is scheduled under that action */
export async function schedulesRun(body: unknown): Promise<{ ran: number } | null> {
  const run = (body as { run?: unknown } | null)?.run;
  if (typeof run !== "string") return null;
  ${scheduling ? "const ran = await runSchedulesFor(run, hookNow(body));\n  return ran ? { ran } : null;" : "return null;"}
}

/** GET /api/osl-hooks/emails?to=&subject= : captured mail, newest last */
export function emailsSent(query: { to?: string; subject?: string }): { to: string; subject: string; text: string }[] {
  ${
    options.email
      ? `return captured
    .filter(e => (!query.to || e.to === query.to) && (!query.subject || e.subject.includes(query.subject)))
    .map(e => ({ to: e.to, subject: e.subject, text: e.text }));`
      : "void query;\n  return [];"
  }
}
`;
}
