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

/**
 * Give the app role of an isolated database (`auth.tenancy.isolation: database`) a way to sign in. The migrations
 * create the role without a login and without a password, so no secret is ever in a generated file: the password
 * comes from the connection string the web process will use (`DATABASE_APP_URL`), which only the environment
 * holds. When its user is the app role itself, the role gains LOGIN with that password; any other name becomes a
 * login that is a member of the app role, so several databases of one cluster can each have their own.
 * `databaseUrl` is a role allowed to alter the app role: the owner that ran the migrations, or an administrator.
 */
export async function provisionAppLogin(databaseUrl: string, appRole: string, appUrl: string): Promise<string> {
  const url = new URL(appUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!user || !password) throw new Error("DATABASE_APP_URL needs a user and a password");
  const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return withClient(databaseUrl, async client => {
    const { rows } = await client.query<{ me: boolean; bypass: boolean }>(
      `SELECT rolname = current_user AS me, (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = $1`,
      [user]
    );
    if (rows[0]?.me)
      throw new Error(`DATABASE_APP_URL connects as ${user}, the role that migrates; the policies do not bind it`);
    if (rows[0]?.bypass)
      throw new Error(`DATABASE_APP_URL connects as ${user}, a role that bypasses row security; use ${appRole}`);
    if (user === appRole) {
      await client.query(`ALTER ROLE ${ident(appRole)} LOGIN PASSWORD ${literal(password)}`);
      return `${appRole} can sign in`;
    }
    if (rows.length === 0)
      await client.query(`CREATE ROLE ${ident(user)} LOGIN PASSWORD ${literal(password)} IN ROLE ${ident(appRole)}`);
    else {
      await client.query(`ALTER ROLE ${ident(user)} LOGIN PASSWORD ${literal(password)}`);
      await client.query(`GRANT ${ident(appRole)} TO ${ident(user)}`);
    }
    return `${user} can sign in as a member of ${appRole}`;
  });
}
