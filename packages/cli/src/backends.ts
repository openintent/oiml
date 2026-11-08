import type { Backend } from "@osl/core";
import { drizzleNextBackend } from "@osl/backend-drizzle-next";
import { ginPgxBackend } from "@osl/backend-gin-pgx";
import { honoTrpcViteBackend } from "@osl/backend-hono-trpc-vite";

export const BACKENDS: Record<string, Backend> = {
  [drizzleNextBackend.name]: drizzleNextBackend,
  [ginPgxBackend.name]: ginPgxBackend,
  [honoTrpcViteBackend.name]: honoTrpcViteBackend
};

export function backendNamed(name: string): Backend {
  const backend = BACKENDS[name];
  if (!backend) throw new Error(`unknown backend "${name}"; available: ${Object.keys(BACKENDS).join(", ")}`);
  return backend;
}
