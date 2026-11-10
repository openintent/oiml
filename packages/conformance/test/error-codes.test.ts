/**
 * A refusal answers the same contract code on every backend. drizzle-next and gin-pgx put it in `{ error: { code } }`;
 * hono-trpc-vite puts it in the tRPC error's data as `contractCode`, beside tRPC's own code, so a scenario that
 * expects `{ error: { code: invalid_transition } }` means the same on the three of them.
 *
 * Both TypeScript mappers are run, not read, as `busy.test.ts` runs them: drizzle-next's `generated/http.ts` and
 * hono-trpc-vite's `generated/server/errors.ts` (against a stand-in for `@trpc/server`'s error class). The codes a
 * request answers end to end are the scenarios of todo TODO-9.
 */
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyIntent, initProject, listIntents, loadProject, type Backend } from "@osl/core";
import { drizzleNextBackend } from "@osl/backend-drizzle-next";
import { honoTrpcViteBackend } from "@osl/backend-hono-trpc-vite";

const FIXTURES = path.resolve(__dirname, "../../../fixtures");
const OPERATIONS = ["read", "write", "delete"] as const;
/** Every PostgreSQL code the mappers know: unique, references, not null, format, busy, and 42501 under isolation */
const DATABASE_CODES = ["23505", "23503", "23001", "23502", "22P02", "55P03", "40P01", "40001", "42501", "XX000"];

interface TrpcError extends Error {
  code: string;
  cause?: unknown;
}

interface ErrorsModule {
  toTRPCError(err: unknown, operation: (typeof OPERATIONS)[number]): TrpcError;
  codeOf(err: TrpcError): string;
  statusOf(err: unknown): number | undefined;
  fail(status: number, code: string, message: string): never;
  notFound(): TrpcError;
}

interface HttpModule {
  handleError(err: unknown, operation: (typeof OPERATIONS)[number]): Response;
}

let scratch: string;
let TRPCError: new (opts: { code: string; message?: string; cause?: unknown }) => TrpcError;
const http = new Map<string, HttpModule>();
const errors = new Map<string, ErrorsModule>();
/** tRPC's own status for a code, for an error that carries no status of the contract's */
const TRPC_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

async function filesOf(backend: Backend, fixture: string): Promise<Map<string, string>> {
  const root = await mkdtemp(path.join(tmpdir(), "osl-codes-"));
  await initProject(root, { name: fixture, backend: backend.name });
  await cp(path.join(FIXTURES, fixture, "intents"), path.join(root, ".osl/intents"), { recursive: true });
  for (const id of await listIntents(root)) await applyIntent(root, id);
  const project = await loadProject(root);
  await rm(root, { recursive: true, force: true });
  const files = backend.generate({ ir: project.ir, revisions: project.lock.revisions, config: project.config });
  return new Map(files.map(f => [f.path, f.content]));
}

async function load<T>(name: string, source: string): Promise<T> {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  const file = path.join(scratch, `${name}.mjs`);
  await writeFile(file, js);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as T;
}

const dbError = (code: string) =>
  Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("database"), { code }) });

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "osl-codes-run-"));
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
  // todo is not isolated; workspace is, so its mappers also know 42501
  for (const fixture of ["todo", "workspace"]) {
    const rest = (await filesOf(drizzleNextBackend as Backend, fixture)).get("generated/http.ts")!;
    http.set(fixture, await load<HttpModule>(`${fixture}-http`, rest));
    const trpc = (await filesOf(honoTrpcViteBackend as Backend, fixture)).get("generated/server/errors.ts")!;
    errors.set(
      fixture,
      await load<ErrorsModule>(`${fixture}-errors`, trpc.replace('from "@trpc/server"', 'from "./trpc-stub.mjs"'))
    );
  }
}, 120_000);

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("contract codes under tRPC", () => {
  it("are the codes drizzle-next answers for every database error, with the same status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const fixture of ["todo", "workspace"]) {
      const { toTRPCError, codeOf, statusOf } = errors.get(fixture)!;
      const { handleError } = http.get(fixture)!;
      for (const code of DATABASE_CODES)
        for (const operation of OPERATIONS) {
          const response = handleError(dbError(code), operation);
          const body = (await response.json()) as { error: { code: string } };
          const mapped = toTRPCError(dbError(code), operation);
          const what = `${fixture} ${code} ${operation}`;
          expect(codeOf(mapped), what).toBe(body.error.code);
          expect(statusOf(mapped) ?? TRPC_STATUS[mapped.code], what).toBe(response.status);
        }
    }
    vi.restoreAllMocks();
  });

  it("are a refusal's own code, whatever tRPC code carries it", () => {
    const { codeOf, fail, notFound } = errors.get("todo")!;
    const refused = (status: number, code: string) => {
      try {
        fail(status, code, "refused");
      } catch (err) {
        return err as TrpcError;
      }
      throw new Error("fail() returned");
    };
    for (const [status, code] of [
      [409, "invalid_transition"],
      [409, "conflict"],
      [409, "invite_exists"],
      [409, "already_member"],
      [410, "invite_expired"],
      [403, "invite_email_mismatch"],
      [403, "registration_closed"],
      [401, "sign_in_required"],
      [400, "invalid_token"],
      [400, "invalid_reference"],
      [400, "validation"]
    ] as const)
      expect(codeOf(refused(status, code)), code).toBe(code);
    expect(codeOf(notFound())).toBe("not_found");
  });

  it("are the REST codes for the errors tRPC and hooks raise themselves", () => {
    const { codeOf } = errors.get("todo")!;
    const of = (code: string, cause?: unknown) => codeOf(new TRPCError({ code, cause }));
    // An input the procedure's schema refused, a body that is not JSON
    expect(of("BAD_REQUEST", new Error("zod"))).toBe("validation");
    expect(of("PARSE_ERROR")).toBe("invalid_json");
    expect(of("UNAUTHORIZED")).toBe("unauthenticated");
    expect(of("FORBIDDEN")).toBe("forbidden");
    expect(of("NOT_FOUND")).toBe("not_found");
    expect(of("CONFLICT")).toBe("conflict");
    expect(of("INTERNAL_SERVER_ERROR", new Error("boom"))).toBe("internal");
    // A hook's own 503 is not the busy answer; tRPC's code, lower case, is the code of anything else
    expect(of("SERVICE_UNAVAILABLE")).toBe("service_unavailable");
    expect(of("TOO_MANY_REQUESTS")).toBe("too_many_requests");
  });

  it("travel in the error's data, where both test clients read them", async () => {
    const files = await filesOf(honoTrpcViteBackend as Backend, "todo");
    const trpc = files.get("generated/server/trpc.ts")!;
    expect(trpc).toContain("contractCode: codeOf(error)");
    const client = files.get("generated/tests/_client.ts")!;
    expect(client).toContain(`code: error?.data?.contractCode ?? String(error?.data?.code ?? "error").toLowerCase()`);
  });
});
