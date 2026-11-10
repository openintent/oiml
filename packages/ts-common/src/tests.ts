import type { IR, StepIR } from "@osl/core";
import { q, type TsConventions } from "./conventions.js";

/** `const HIDDEN = ...`: every hidden column across the model, which no response may carry */
export function hiddenColumnsDecl(ir: IR): string {
  const hidden = [...new Set(ir.entities.flatMap(e => e.columns.filter(c => c.hidden).map(c => c.name)))].sort();
  return `/** Columns that must never appear in any response */
const HIDDEN = new Set<string>([${hidden.map(q).join(", ")}]);`;
}

/** `assertNoHidden(value, path)`: throws when a hidden column appears anywhere in a response */
export function assertNoHiddenSource(): string {
  return `function assertNoHidden(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoHidden(item, path);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (HIDDEN.has(key)) throw new Error("hidden column " + key + " leaked in the response of " + path);
      assertNoHidden(inner, path);
    }
  }
}`;
}

/** `export const ACTORS = ...` from the model's example actors */
export function actorsDecl(ir: IR): string {
  const actors = Object.entries(ir.examples.actors)
    .map(
      ([name, a]) =>
        `  ${name}: { email: ${q(a.email)}, password: ${q(a.password)}, fields: ${JSON.stringify(a.fields)}, provisioned: ${JSON.stringify(a.provisioned)} }`
    )
    .join(",\n");
  return `export const ACTORS: Record<string, { email: string; password: string; fields: Record<string, unknown>; provisioned: Record<string, unknown> }> = {
${actors}
};`;
}

/** Whether some actor sets a column register refuses, which the harness writes straight into the database */
export function needsProvisioning(ir: IR): boolean {
  return Boolean(ir.auth) && Object.values(ir.examples.actors).some(a => Object.keys(a.provisioned).length > 0);
}

/** `provision(name)`: writes an actor's provisioned identity columns (its role) into the database after registering */
export function provisionSource(ir: IR): string {
  if (!needsProvisioning(ir))
    return `/** No actor sets a column register refuses, so there is nothing to provision after registering. */
async function provision(_name: string): Promise<void> {}`;
  const { identityTable, emailColumn } = ir.auth!;
  return `/**
 * Writes the actor's identity columns that register refuses (its role) straight into the database, so a scenario
 * can act as an admin. Needs DATABASE_URL: the database the app under test runs on.
 */
async function provision(name: string): Promise<void> {
  const definition = ACTORS[name];
  const entries = Object.entries(definition.provisioned);
  if (entries.length === 0) return;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "actor " + name + " sets " + entries.map(([column]) => column).join(", ") + ", which is written straight to the database: set DATABASE_URL"
    );
  }
  const db = new PgClient({ connectionString: url });
  await db.connect();
  try {
    const sets = entries.map(([column], i) => '"' + column + '" = $' + (i + 1)).join(", ");
    await db.query(
      'update "${identityTable}" set ' + sets + ' where "${emailColumn}" = $' + (entries.length + 1),
      [...entries.map(([, value]) => value), definition.email]
    );
  } finally {
    await db.end();
  }
}`;
}

/** Whether a scenario says a path must be absent, so the test client needs to tell a missing key from a null one */
export function usesAbsent(ir: IR): boolean {
  return ir.examples.scenarios.some(s => s.steps.some(step => step.expect.absent?.length));
}

/** `carries`: whether a dotted path is in a response body, for `expect.absent` */
function carriesSource(): string {
  return `

/**
 * Whether the dotted path is in a response body: every key on the way is there, whatever its value (a null is
 * there). Through a list, it is there when any item carries the rest of the path.
 */
export function carries(value: unknown, path: string): boolean {
  const walk = (current: unknown, keys: string[]): boolean => {
    if (Array.isArray(current)) return current.some(item => walk(item, keys));
    if (!current || typeof current !== "object" || !(keys[0] in current)) return false;
    return keys.length === 1 || walk((current as Record<string, unknown>)[keys[0]], keys.slice(1));
  };
  return walk(value, path.split("."));
}`;
}

/** `matches`, `resolve` and `pick`: partial matching and "{var}" substitution for scenario steps */
export function matchersSource(ir?: IR): string {
  return matchers() + (ir && usesAbsent(ir) ? carriesSource() : "");
}

function matchers(): string {
  return `/** Partial deep match: every expected key must match; every expected array element must match some actual element. */
export function matches(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every(item => actual.some(candidate => matches(item, candidate)));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) => matches(value, (actual as Record<string, unknown>)[key]));
  }
  return Object.is(expected, actual);
}

/** Replace "{name}" and "{name.path}" strings with captured values. */
export function resolve(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const whole = value.match(/^\\{([a-zA-Z0-9_.+-]+)\\}$/);
    if (whole) return lookup(vars, whole[1]);
    return value.replace(/\\{([a-zA-Z0-9_.+-]+)\\}/g, (_, name: string) => String(lookup(vars, name)));
  }
  if (Array.isArray(value)) return value.map(item => resolve(item, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, resolve(inner, vars)]));
  }
  return value;
}

/** A template's value: {now}, {now+2h} and {now-30d} are timestamps; anything else is a captured value */
function lookup(vars: Record<string, unknown>, name: string): unknown {
  const now = name.match(/^now(?:([+-])(\\d+)([mhd]))?$/);
  if (!now) return pick(vars, name);
  const unit = now[3] === "m" ? 60_000 : now[3] === "h" ? 3_600_000 : 86_400_000;
  const offset = now[2] ? Number(now[2]) * unit * (now[1] === "-" ? -1 : 1) : 0;
  return new Date(Date.now() + offset).toISOString();
}

export function pick(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object") return (current as Record<string, unknown>)[key];
    return undefined;
  }, value);
}`;
}

/** The `it(...)` title of a step */
export function stepTitle(step: StepIR, number: number): string {
  return step.name ?? `${number}. ${step.as ? step.as + " " : ""}${step.op}`;
}

/** Capture lines: `vars.x = pick(reply.body, "data.id");` */
export function captureLines(step: StepIR): string[] {
  return Object.entries(step.capture).map(([name, path]) => `    vars.${name} = pick(reply.body, ${q(path)});`);
}

/** The partial body assertion of a step and the paths that must be absent, or an empty string */
export function bodyCheck(step: StepIR): string {
  const body =
    step.expect.body !== undefined
      ? `    const expected = resolve(${JSON.stringify(step.expect.body)}, scope);
    expect(matches(expected, reply.body), "expected " + JSON.stringify(expected) + " within " + JSON.stringify(reply.body)).toBe(true);`
      : "";
  const absent = step.expect.absent?.length
    ? `    for (const path of ${JSON.stringify(step.expect.absent)}) expect(carries(reply.body, path), path + " must be absent from " + JSON.stringify(reply.body)).toBe(false);`
    : "";
  return [body, absent].filter(Boolean).join("\n");
}

/** `carries, ` in a test file's import of the client when one of its steps says a path must be absent */
export function carriesImport(steps: StepIR[]): string {
  return steps.some(step => step.expect.absent?.length) ? "carries, " : "";
}

export function vitestConfigFile(conv: TsConventions): string {
  return `${conv.header("Vitest config for the contract tests.")}
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

/** Scenarios build on each other, so their files run one at a time in name order. */
class InOrder extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig({
  test: {
    include: ["generated/tests/**/*.test.ts"],
    fileParallelism: false,
    sequence: { sequencer: InOrder },
    testTimeout: 30_000,
    hookTimeout: 60_000
  }
});
`;
}
