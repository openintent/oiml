import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Load KEY=value pairs from .env into process.env without overriding what is already set. */
export function loadDotEnv(root: string): void {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function requireDatabaseUrl(root: string, override?: string): string {
  loadDotEnv(root);
  const url = override ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set; pass --url or put it in .env");
  return url;
}
