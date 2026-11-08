import { DrizzleQueryError } from "drizzle-orm";

// Drizzle wraps driver errors; the database error code lives on error.cause
export function getDbErrorCode(error: unknown): string | undefined {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (typeof cause !== "object" || cause === null) return undefined;
  // libSQL puts the specific code in extendedCode
  const { code, extendedCode } = cause as { code?: string; extendedCode?: string };
  return extendedCode ?? code;
}
