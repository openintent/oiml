/**
 * The order's database objects under concurrent writers, on a real PostgreSQL. Runs when OSL_TEST_DATABASE_URL is
 * set (the conformance run's variable) and is skipped without it, like the harness itself.
 *
 * Many connections at once append, move and remove entries of a few lists, delete entries with a plain DELETE (a
 * handler's own statement) and delete the items the entries point at (a cascade from the far side of the junction).
 * No statement may fail for a reason the caller did not earn: no deadlock, no unique violation, no serialization
 * failure. No two entries of a list may share a place at any time, and once a list's last writer is done its places
 * are 1..n. The control takes the parent's lock out of the append trigger and expects the same load to fail.
 *
 * What the load leaves out is the one thing the database cannot order: a transaction of the caller's own that writes
 * two lists, against another that writes them the other way round, takes the two parents' locks in opposite orders.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Model, compile, orderObjects, planMigration, renderPostgres } from "../src/index.js";

const url = process.env.OSL_TEST_DATABASE_URL;

const model = Model.parse({
  osl: "1.0",
  name: "order-stress",
  entities: {
    List: { fields: { id: { type: "integer", primary: true }, name: { type: "string", required: true } } },
    Item: { fields: { id: { type: "integer", primary: true }, name: { type: "string", required: true } } },
    Entry: {
      fields: {
        id: { type: "integer", primary: true },
        list_id: { type: "integer", required: true, relation: { entity: "List", on_delete: "cascade" } },
        item_id: { type: "integer", required: true, relation: { entity: "Item", on_delete: "cascade" } },
        position: { type: "integer", position: { within: "list_id" } }
      }
    }
  }
});

/** A small deterministic generator, so a failure replays */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!url)("an order under concurrent writers", () => {
  const database = `osl_order_${Date.now().toString(36)}`;
  const LISTS = 3;
  const ITEMS = 40;
  const WORKERS = 24;
  // A heavier or a replayed load: OSL_ORDER_ROUNDS writes per connection, from OSL_ORDER_SEED
  const ROUNDS = Number(process.env.OSL_ORDER_ROUNDS ?? 60);
  const SEED = Number(process.env.OSL_ORDER_SEED ?? 1);
  let admin: pg.Client;
  let pool: pg.Pool;

  const withDatabase = (name: string) => {
    const next = new URL(url!);
    next.pathname = `/${name}`;
    return next.toString();
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    pool = new pg.Pool({ connectionString: withDatabase(database), max: WORKERS });
    // The database is dropped with its connections at the end: a connection still closing then must not fail the run
    pool.on("error", () => {});
    pool.on("connect", client => client.on("error", () => {}));
    await pool.query(renderPostgres(planMigration(null, compile(model))));
    await pool.query(`INSERT INTO lists (name) SELECT 'list ' || n FROM generate_series(1, ${LISTS}) AS n`);
    await pool.query(`INSERT INTO items (name) SELECT 'item ' || n FROM generate_series(1, ${ITEMS}) AS n`);
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin?.end();
  });

  /** The places of every list, list by list in order */
  const places = async (): Promise<Map<number, number[]>> => {
    const { rows } = await pool.query<{ list_id: number; position: number }>(
      "SELECT list_id, position FROM entries ORDER BY list_id, position"
    );
    const out = new Map<number, number[]>();
    for (const row of rows) (out.get(row.list_id) ?? out.set(row.list_id, []).get(row.list_id)!).push(row.position);
    return out;
  };

  /** WORKERS connections each run `rounds` random writes; what failed comes back by SQLSTATE */
  const load = async (seed: number, rounds: number, lists: number): Promise<Map<string, number>> => {
    const failures = new Map<string, number>();
    const fail = (what: string, error: unknown) => {
      const code = (error as { code?: string }).code ?? "unknown";
      // The one failure a caller earns: an entry for an item another connection has just deleted
      if (what === "append" && code === "23503") return;
      const key = `${what}: ${code} ${(error as Error).message}`;
      failures.set(key, (failures.get(key) ?? 0) + 1);
    };
    await Promise.all(
      Array.from({ length: WORKERS }, async (_, worker) => {
        const next = rng(seed * 1000 + worker);
        const pick = (n: number) => 1 + Math.floor(next() * n);
        for (let round = 0; round < rounds; round++) {
          const list = pick(lists);
          const dice = next();
          const someEntry = `(SELECT id FROM entries WHERE list_id = ${list} ORDER BY random() LIMIT 1)`;
          try {
            if (dice < 0.4) {
              await pool.query("INSERT INTO entries (list_id, item_id) VALUES ($1, $2)", [list, pick(ITEMS)]);
            } else if (dice < 0.65) {
              await pool.query(`SELECT osl_move_entries(${someEntry}, $1)`, [pick(12)]);
            } else if (dice < 0.8) {
              await pool.query(`SELECT osl_remove_entries(${someEntry})`);
            } else if (dice < 0.88) {
              // A handler's own DELETE: the rows are held before the trigger looks for the parent's lock
              await pool.query(`DELETE FROM entries WHERE id = ${someEntry}`);
            } else if (dice < 0.95) {
              // The far side goes: its entries leave every list they are in, by cascade
              const item = pick(ITEMS);
              await pool.query("DELETE FROM items WHERE id = $1", [item]);
              await pool.query(
                "INSERT INTO items (id, name) OVERRIDING SYSTEM VALUE VALUES ($1, 'again') ON CONFLICT DO NOTHING",
                [item]
              );
            } else {
              // Two writes to one list in one transaction: its locks are held across statements
              const client = await pool.connect();
              try {
                await client.query("BEGIN");
                await client.query("INSERT INTO entries (list_id, item_id) VALUES ($1, $2)", [list, pick(ITEMS)]);
                await client.query(`SELECT osl_move_entries(${someEntry}, 1)`);
                await client.query("COMMIT");
              } catch (error) {
                await client.query("ROLLBACK");
                throw error;
              } finally {
                client.release();
              }
            }
          } catch (error) {
            fail(
              dice < 0.4 || dice >= 0.95 ? "append" : dice < 0.65 ? "move" : dice < 0.88 ? "remove" : "cascade",
              error
            );
          }
        }
      })
    );
    return failures;
  };

  it("fails no writer and leaves every list in order", async () => {
    const failures = await load(SEED, ROUNDS, LISTS);
    expect([...failures.entries()]).toEqual([]);
    // No two entries of a list share a place, whatever the cascades left
    for (const [list, seen] of await places()) expect(new Set(seen).size, `list ${list}`).toBe(seen.length);
    // The next move of each list closes what a cascade could not: after it the places are 1..n
    for (let list = 1; list <= LISTS; list++) {
      await pool.query("INSERT INTO entries (list_id, item_id) VALUES ($1, (SELECT min(id) FROM items))", [list]);
      await pool.query("SELECT osl_move_entries((SELECT min(id) FROM entries WHERE list_id = $1), 1)", [list]);
    }
    for (const [list, seen] of await places()) expect(seen, `list ${list}`).toEqual(seen.map((_, index) => index + 1));
    expect((await places()).size).toBe(LISTS);
  }, 120_000);

  it("keeps the places 1..n at every moment when the writers are appends, moves and removes alone", async () => {
    // Without cascades and plain deletes every writer waits for the parent's lock: no gap is ever left for later
    await pool.query("TRUNCATE entries");
    const failures = new Map<string, number>();
    const next = rng(7);
    await Promise.all(
      Array.from({ length: WORKERS * 20 }, async () => {
        const dice = next();
        const someEntry = "(SELECT id FROM entries WHERE list_id = 1 ORDER BY random() LIMIT 1)";
        try {
          if (dice < 0.5)
            await pool.query("INSERT INTO entries (list_id, item_id) VALUES (1, (SELECT min(id) FROM items))");
          else if (dice < 0.8)
            await pool.query(`SELECT osl_move_entries(${someEntry}, $1)`, [1 + Math.floor(next() * 9)]);
          else await pool.query(`SELECT osl_remove_entries(${someEntry})`);
        } catch (error) {
          const key = `${(error as { code?: string }).code} ${(error as Error).message}`;
          failures.set(key, (failures.get(key) ?? 0) + 1);
        }
      })
    );
    expect([...failures.entries()]).toEqual([]);
    const seen = (await places()).get(1) ?? [];
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual(seen.map((_, index) => index + 1));
  }, 120_000);

  it("control: without the parent's lock the same appends collide", async () => {
    await pool.query("TRUNCATE entries");
    const assign = orderObjects(compile(model)).find(o => o.name === "osl_position_entries")!;
    const unlocked = assign
      .body!.source.split("\n")
      .filter(line => !line.includes("FOR NO KEY UPDATE"))
      .join("\n");
    expect(unlocked).not.toBe(assign.body!.source);
    await pool.query(
      `CREATE OR REPLACE FUNCTION osl_position_entries() RETURNS trigger LANGUAGE plpgsql AS $$\n${unlocked}\n$$`
    );
    const codes = new Map<string, number>();
    await Promise.all(
      Array.from({ length: WORKERS * 10 }, async () => {
        try {
          await pool.query("INSERT INTO entries (list_id, item_id) VALUES (1, (SELECT min(id) FROM items))");
        } catch (error) {
          const code = (error as { code?: string }).code ?? "unknown";
          codes.set(code, (codes.get(code) ?? 0) + 1);
        }
      })
    );
    // Two appends counted the same rows and took the same place: the constraint refuses one of them
    expect(codes.get("23505") ?? 0).toBeGreaterThan(0);
  }, 60_000);
});

/** Teams, projects in a team, milestones in order in a project: the milestone's tenant is derived through its project */
const isolated = Model.parse({
  osl: "1.0",
  name: "order-guard",
  entities: {
    User: {
      fields: { id: { type: "uuid", primary: true }, email: { type: "string", required: true, unique: true } },
      rules: { read: "authenticated", update: "owner:id", delete: "none" }
    },
    Team: {
      fields: { id: { type: "uuid", primary: true }, name: { type: "string", required: true } },
      rules: { read: "member:id", create: "authenticated", update: "member:id:admin", delete: "member:id:owner" }
    },
    TeamMember: {
      fields: {
        id: { type: "uuid", primary: true },
        team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
        user_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
        role: { type: "enum", enum_values: ["owner", "admin", "member"], required: true, default: "member" }
      },
      unique: [["team_id", "user_id"]],
      rules: { read: "member:team_id", create: "member:team_id:admin", update: "none", delete: "member:team_id:owner" }
    },
    Project: {
      fields: {
        id: { type: "uuid", primary: true },
        team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
        name: { type: "string", required: true }
      },
      rules: { read: "member:team_id", create: "member:team_id", update: "member:team_id", delete: "member:team_id" }
    },
    Milestone: {
      fields: {
        id: { type: "uuid", primary: true },
        project_id: { type: "uuid", required: true, relation: { entity: "Project", on_delete: "cascade" } },
        title: { type: "string", required: true },
        position: { type: "integer", position: { within: "project_id" } }
      },
      rules: {
        read: "member:project_id.team_id",
        create: "member:project_id.team_id",
        update: "member:project_id.team_id",
        delete: "member:project_id.team_id"
      }
    }
  },
  auth: {
    identity: "User",
    provider: "credentials",
    tenancy: {
      entity: "Team",
      membership: "TeamMember",
      role_field: "role",
      creator_role: "owner",
      isolation: "database"
    }
  }
});

describe.skipIf(!url)("an order's functions under isolation: database", () => {
  const database = `osl_order_guard_${Date.now().toString(36)}`;
  const ir = compile(isolated);
  const { appRole, setting } = ir.auth!.tenancy!.isolation!;
  let admin: pg.Client;
  let db: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    const next = new URL(url!);
    next.pathname = `/${database}`;
    db = new pg.Client({ connectionString: next.toString() });
    db.on("error", () => {});
    await db.connect();
    await db.query(renderPostgres(planMigration(null, ir)));
  }, 30_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    // The app role belongs to the cluster: this test made it and nothing else uses its name
    await admin?.query(`DROP ROLE IF EXISTS "${appRole}"`);
    await admin?.end();
  });

  it("move and remove refuse a row the bound tenants do not hold, as the policy would", async () => {
    const one = async <T>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0] as T;
    const id = async (sql: string, args: unknown[] = []) => (await one<{ id: string }>(sql, args)).id;
    const teamA = await id("INSERT INTO teams (name) VALUES ('A') RETURNING id");
    const teamB = await id("INSERT INTO teams (name) VALUES ('B') RETURNING id");
    const projectA = await id("INSERT INTO projects (team_id, name) VALUES ($1, 'PA') RETURNING id", [teamA]);
    const projectB = await id("INSERT INTO projects (team_id, name) VALUES ($1, 'PB') RETURNING id", [teamB]);
    const milestone = (project: string, title: string) =>
      id("INSERT INTO milestones (project_id, title) VALUES ($1, $2) RETURNING id", [project, title]);
    const [a1, a2, a3] = [
      await milestone(projectA, "a1"),
      await milestone(projectA, "a2"),
      await milestone(projectA, "a3")
    ];
    const [b1, b2] = [await milestone(projectB, "b1"), await milestone(projectB, "b2")];
    const places = async (project: string) =>
      (await db.query("SELECT title FROM milestones WHERE project_id = $1 ORDER BY position", [project])).rows.map(
        r => (r as { title: string }).title
      );
    const move = async (row: string, to: number) =>
      (await one<{ place: number | null }>("SELECT osl_move_milestones($1, $2) AS place", [row, to])).place;
    const remove = async (row: string) =>
      (await one<{ gone: boolean }>("SELECT osl_remove_milestones($1) AS gone", [row])).gone;
    const bind = (teams: string[]) => db.query("SELECT set_config($1, $2, false)", [setting, `{${teams.join(",")}}`]);

    // As the role the web process connects as: the policies bind it, the functions run with their owner's rights
    await db.query(`SET ROLE "${appRole}"`);
    try {
      // Nothing bound: no row is the caller's, and the functions answer as for a missing row
      expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM milestones")).n).toBe(0);
      expect(await move(a3, 1)).toBeNull();
      expect(await remove(a1)).toBe(false);
      // Another tenant bound: the same
      await bind([teamB]);
      expect(await move(a3, 1)).toBeNull();
      expect(await remove(a1)).toBe(false);
      expect(await move(b2, 1)).toBe(1);
      // The row's tenant bound: the row moves and leaves
      await bind([teamA]);
      expect(await move(a3, 1)).toBe(1);
      expect(await remove(a1)).toBe(true);
      expect(await remove(b1)).toBe(false);
      // The pieces behind them are nobody's to call
      await expect(db.query("SELECT osl_hold_milestones($1)", [projectA])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.query("RESET ROLE");
    }
    expect(await places(projectA)).toEqual(["a3", "a2"]);
    expect(await places(projectB)).toEqual(["b2", "b1"]);
    void a2;
  }, 30_000);
});
