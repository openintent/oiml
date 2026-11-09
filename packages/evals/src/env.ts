import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Load KEY=value pairs from a file into process.env without overriding what is already set */
export function loadEnv(file: string): void {
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

/** `.env.local` then `.env` at the repo root, the way every eval command reads its credentials */
export function loadRepoEnv(repoRoot: string): void {
  loadEnv(path.join(repoRoot, ".env.local"));
  loadEnv(path.join(repoRoot, ".env"));
}
