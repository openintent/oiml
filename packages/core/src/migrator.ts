/**
 * Applies SQL migration files in order and records each one in `osl_migrations`.
 * A file that was applied and later changed is reported, never re-run.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { sha256 } from "./canonical.js";

export interface MigrationFile {
  name: string;
  path: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function listMigrationFiles(dir: string): Promise<MigrationFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = names.filter(n => n.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async name => {
      const sql = await readFile(path.join(dir, name), "utf8");
      return { name, path: path.join(dir, name), sql, checksum: sha256(sql) };
    })
  );
}

export async function withClient<T>(databaseUrl: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function runMigrations(databaseUrl: string, dir: string): Promise<MigrateResult> {
  const files = await listMigrationFiles(dir);
  return withClient(databaseUrl, async client => {
    await client.query(
      `CREATE TABLE IF NOT EXISTS "osl_migrations" ("name" text PRIMARY KEY, "checksum" text NOT NULL, "applied_at" timestamptz NOT NULL DEFAULT now())`
    );
    const { rows } = await client.query<{ name: string; checksum: string }>(
      `SELECT "name", "checksum" FROM "osl_migrations"`
    );
    const applied = new Map(rows.map(r => [r.name, r.checksum]));
    const result: MigrateResult = { applied: [], skipped: [] };

    for (const file of files) {
      const existing = applied.get(file.name);
      if (existing !== undefined) {
        if (existing !== file.checksum)
          throw new Error(
            `migration ${file.name} was applied with a different checksum; migrations must not change after they run`
          );
        result.skipped.push(file.name);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(file.sql);
        await client.query(`INSERT INTO "osl_migrations" ("name", "checksum") VALUES ($1, $2)`, [
          file.name,
          file.checksum
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      result.applied.push(file.name);
    }
    return result;
  });
}

export async function pendingMigrations(databaseUrl: string, dir: string): Promise<string[]> {
  const files = await listMigrationFiles(dir);
  return withClient(databaseUrl, async client => {
    const exists = await client.query(`SELECT to_regclass('"osl_migrations"') AS t`);
    if (!exists.rows[0]?.t) return files.map(f => f.name);
    const { rows } = await client.query<{ name: string }>(`SELECT "name" FROM "osl_migrations"`);
    const applied = new Set(rows.map(r => r.name));
    return files.filter(f => !applied.has(f.name)).map(f => f.name);
  });
}
