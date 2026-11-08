import type { TsConventions } from "./conventions.js";

/**
 * Where a backend keeps the modules the shared server code depends on, as import specifiers relative
 * to the generated directory's root (`./http`, `./server/errors`).
 */
export interface ServerConventions extends TsConventions {
  /** Exports `fail(status, code, message): never` */
  errorsModule: string;
  /** Exports the `Session` type */
  authModule: string;
}
