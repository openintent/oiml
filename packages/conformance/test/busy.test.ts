/**
 * A lock another request holds is not a server error: `lock_not_available` (55P03, an ordered table's move or
 * remove giving up on a held row), `deadlock_detected` (40P01, PostgreSQL ending two writers that wait for each
 * other by failing one) and `serialization_failure` (40001) answer 503 `busy` with `Retry-After: 1` on every
 * backend, instead of the 500 an unknown database error gets.
 *
 * The mapper of each TypeScript backend is run, not read: `generated/http.ts` of drizzle-next and
 * `generated/server/errors.ts` of hono-trpc-vite are transpiled and imported (the second against a stand-in for
 * `@trpc/server`'s error class, which this repository does not install). The Go mapper needs gin and pgx to
 * build, which a unit test has no business downloading, so `generated/httpx/httpx.go` is read. What the three
 * servers answer over HTTP when a real lock is held is the hardening pass's end-to-end run.
 */
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyIntent, initProject, listIntents, loadProject, type Backend } from "@osl/core";
import { drizzleNextBackend } from "@osl/backend-drizzle-next";
import { ginPgxBackend } from "@osl/backend-gin-pgx";
import { honoTrpcViteBackend } from "@osl/backend-hono-trpc-vite";

const FIXTURES = path.resolve(__dirname, "../../../fixtures");
const BUSY = ["55P03", "40P01", "40001"];
const OPERATIONS = ["read", "write", "delete"] as const;
const MESSAGE = "Another request is changing the same rows. Try again.";

/** music has an ordered table and no isolation; workspace is isolated, so its mappers also know 42501 */
const PROJECTS = ["music", "workspace"];

async function filesOf(backend: Backend, fixture: string): Promise<Map<string, string>> {
  const root = await mkdtemp(path.join(tmpdir(), "osl-busy-"));
  await initProject(root, { name: fixture, backend: backend.name });
  await cp(path.join(FIXTURES, fixture, "intents"), path.join(root, ".osl/intents"), { recursive: true });
  for (const id of await listIntents(root)) await applyIntent(root, id);
  const project = await loadProject(root);
  await rm(root, { recursive: true, force: true });
  const files = backend.generate({ ir: project.ir, revisions: project.lock.revisions, config: project.config });
  return new Map(files.map(f => [f.path, f.content]));
}

interface HttpModule {
  handleError(err: unknown, operation: "read" | "write" | "delete"): Response;
}

interface TrpcError extends Error {
  code: string;
  cause?: unknown;
}

interface ErrorsModule {
  toTRPCError(err: unknown, operation: "read" | "write" | "delete"): TrpcError;
  isBusy(err: unknown): boolean;
  busy(): TrpcError;
}

let scratch: string;
const generated = new Map<string, Map<string, string>>();
const http = new Map<string, HttpModule>();
const errors = new Map<string, ErrorsModule>();
let TRPCError: new (opts: { code: string; message?: string; cause?: unknown }) => TrpcError;

/** A generated TypeScript module as the app would load it: transpiled, written to a scratch folder, imported */
async function load<T>(name: string, source: string): Promise<T> {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  const file = path.join(scratch, `${name}.mjs`);
  await writeFile(file, js);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as T;
}

/** The error as each driver hands it over: Drizzle wraps the driver's error, a raw query throws it as it is */
const thrown = (code: string) => [
  Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("database"), { code }) }),
  Object.assign(new Error("database"), { code })
];

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "osl-busy-run-"));
  // What the generated module needs of @trpc/server: an error with a code, a message and the cause it was given
  await writeFile(
    path.join(scratch, "trpc-stub.mjs"),
    `export class TRPCError extends Error {
  constructor(opts) {
    super(opts.message ?? opts.code);
    this.name = "TRPCError";
    this.code = opts.code;
    this.cause = opts.cause;
  }
}
`
  );
  TRPCError = ((await import(/* @vite-ignore */ pathToFileURL(path.join(scratch, "trpc-stub.mjs")).href)) as any)
    .TRPCError;
  for (const fixture of PROJECTS) {
    for (const backend of [drizzleNextBackend, honoTrpcViteBackend, ginPgxBackend] as Backend[])
      generated.set(`${backend.name}:${fixture}`, await filesOf(backend, fixture));
    http.set(
      fixture,
      await load<HttpModule>(`${fixture}-http`, generated.get(`drizzle-next:${fixture}`)!.get("generated/http.ts")!)
    );
    const source = generated.get(`hono-trpc-vite:${fixture}`)!.get("generated/server/errors.ts")!;
    expect(source).toContain('from "@trpc/server"');
    errors.set(
      fixture,
      await load<ErrorsModule>(`${fixture}-errors`, source.replace('from "@trpc/server"', 'from "./trpc-stub.mjs"'))
    );
  }
}, 120_000);

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe.each(PROJECTS)("a lock another request holds, on %s", fixture => {
  it("is 503 busy with Retry-After on drizzle-next, whatever the operation and however the driver threw it", async () => {
    const { handleError } = http.get(fixture)!;
    for (const code of BUSY)
      for (const operation of OPERATIONS)
        for (const err of thrown(code)) {
          const response = handleError(err, operation);
          expect(response.status, `${code} ${operation}`).toBe(503);
          expect(response.headers.get("retry-after"), `${code} ${operation}`).toBe("1");
          expect(await response.json(), `${code} ${operation}`).toEqual({ error: { code: "busy", message: MESSAGE } });
        }
  });

  it("leaves every other database error on drizzle-next what it was, without the header", async () => {
    const { handleError } = http.get(fixture)!;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // 57014 is a cancelled statement: not a lock, still the server's 500, and logged
      const unknown = handleError(thrown("57014")[0], "write");
      expect(unknown.status).toBe(500);
      expect(unknown.headers.get("retry-after")).toBeNull();
      expect(await unknown.json()).toEqual({ error: { code: "internal", message: "Something went wrong" } });
      expect(log).toHaveBeenCalledTimes(1);
      const conflict = handleError(thrown("23505")[0], "write");
      expect(conflict.status).toBe(409);
      expect(conflict.headers.get("retry-after")).toBeNull();
      // A busy answer is not the server's fault: nothing is logged for it
      handleError(thrown("55P03")[0], "write");
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("is SERVICE_UNAVAILABLE under tRPC, marked busy for the app to add Retry-After", () => {
    const { toTRPCError, isBusy, busy } = errors.get(fixture)!;
    for (const code of BUSY)
      for (const operation of OPERATIONS)
        for (const err of thrown(code)) {
          const mapped = toTRPCError(err, operation);
          expect(mapped.code, `${code} ${operation}`).toBe("SERVICE_UNAVAILABLE");
          expect(mapped.message).toBe(MESSAGE);
          expect((mapped.cause as { code?: string }).code).toBe("busy");
          expect(isBusy(mapped), `${code} ${operation}`).toBe(true);
        }
    expect(isBusy(busy())).toBe(true);
  });

  it("leaves every other error under tRPC what it was, a hook's own 503 included", () => {
    const { toTRPCError, isBusy } = errors.get(fixture)!;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const unknown = toTRPCError(thrown("57014")[0], "write");
      expect(unknown.code).toBe("INTERNAL_SERVER_ERROR");
      expect(isBusy(unknown)).toBe(false);
      expect(log).toHaveBeenCalledTimes(1);
      const conflict = toTRPCError(thrown("23505")[0], "write");
      expect(conflict.code).toBe("CONFLICT");
      expect(isBusy(conflict)).toBe(false);
      // A tRPC error passes through as it is: a hook that answers 503 for its own reason is not the busy answer
      const own = new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "The mail provider is down" });
      expect(toTRPCError(own, "write")).toBe(own);
      expect(isBusy(own)).toBe(false);
      expect(isBusy(new Error("busy"))).toBe(false);
      expect(isBusy({ code: "SERVICE_UNAVAILABLE", cause: { code: "busy" } })).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it("goes out with Retry-After from the tRPC route and from the REST routes beside it", () => {
    const app = generated.get(`hono-trpc-vite:${fixture}`)!.get("generated/server/app.ts")!;
    // The status a refusal carries (A4) and the busy header share the one responseMeta
    expect(app).toContain('import { codeOf, isBusy, statusOf } from "./errors";');
    expect(app).toContain('const busy = errors.some(isBusy) ? { headers: new Headers({ "Retry-After": "1" }) } : {};');
    expect(app).toContain("return status === undefined ? busy : { status, ...busy };");
    expect(app).toMatch(
      /trpcServer\(\{\n\s+router: appRouter,\n\s+createContext,[\s\S]*responseMeta: \(\{ errors, paths \}\) =>/
    );
    expect(app).toContain('if (isBusy(err)) c.header("Retry-After", "1");');
  });

  it("is the same answer in the Go mapper: the three codes, the header before the body, 503 busy", () => {
    const httpx = generated.get(`gin-pgx:${fixture}`)!.get("generated/httpx/httpx.go")!;
    // The case sits in the SQLSTATE switch of HandleError and ends the handler there
    const handle = httpx.slice(httpx.indexOf("func HandleError("));
    expect(handle).toMatch(/case "55P03", "40P01", "40001":\n(\t\t\t\/\/ [^\n]*\n)+\t\t\tBusy\(c\)\n\t\t\treturn\n/);
    expect(handle.indexOf('case "55P03"')).toBeLessThan(handle.indexOf('log.Printf("internal error'));
    const busy = httpx.slice(httpx.indexOf("func Busy("), httpx.indexOf("// ParseBody"));
    expect(busy).toContain(`func Busy(c *gin.Context) {
	c.Header("Retry-After", "1")
	Fail(c, NewError(http.StatusServiceUnavailable, "busy", "${MESSAGE}"))
}`);
  });

  it("keeps what isolation: database added to the mappers", () => {
    const isolated = fixture === "workspace";
    expect(generated.get(`drizzle-next:${fixture}`)!.get("generated/http.ts")!.includes('"42501"')).toBe(isolated);
    expect(generated.get(`gin-pgx:${fixture}`)!.get("generated/httpx/httpx.go")!.includes('"42501"')).toBe(isolated);
    if (!isolated) return;
    expect(http.get(fixture)!.handleError(thrown("42501")[0], "write").status).toBe(403);
    expect(errors.get(fixture)!.toTRPCError(thrown("42501")[0], "write").code).toBe("FORBIDDEN");
  });
});
