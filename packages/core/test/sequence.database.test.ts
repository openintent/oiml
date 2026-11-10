/**
 * The sequences' database objects under concurrent writers, on a real PostgreSQL. Runs when OSL_TEST_DATABASE_URL
 * is set (the conformance run's variable) and is skipped without it, like the harness itself.
 *
 * Many connections at once create invoices in a few teams (one counter per team) and receipts (one counter for the
 * table): alone, two in one statement, two in one transaction, an invoice and a receipt in one transaction, and in
 * transactions that are rolled back on purpose. No statement may fail, no two rows of a scope may share a number,
 * and when the writers are done each scope's numbers are 1..n without a hole: a create that rolls back gives its
 * number back, because the counter is written in the create's own transaction. The teams count their invoices
 * (`count_of`), so the count's triggers fire inside every one of those inserts. The control reads the counter
 * without holding it, as a handler that asked for `max + 1` would, and expects the same load to collide.
 *
 * Then what a number is afterwards (a deleted row leaves a hole, a number past the width keeps its digits), what a
 * migration does to a table that already has rows, to a renamed field and to a field that is dropped, and what the
 * drift check says of the counter table.
 *
 * The last suite is the sequence under `isolation: database`: the web role cannot read or write a counter, gets a
 * number all the same, and moves no counter with a row the policy refuses.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Model,
  checkDrift,
  compile,
  planMigration,
  renderPostgres,
  sequenceObjects,
  validateModel
} from "../src/index.js";

const url = process.env.OSL_TEST_DATABASE_URL;

const model = Model.parse({
  osl: "1.0",
  name: "sequence-stress",
  entities: {
    Team: {
      fields: {
        id: { type: "integer", primary: true },
        name: { type: "string", required: true },
        invoice_count: { type: "integer", count_of: "invoices" }
      }
    },
    Invoice: {
      fields: {
        id: { type: "integer", primary: true },
        team_id: {
          type: "integer",
          required: true,
          relation: { entity: "Team", reverse: "invoices", on_delete: "cascade" }
        },
        number: { type: "sequence", prefix: "INV-", scope: ["team_id"], width: 4 }
      }
    },
    Receipt: {
      fields: { id: { type: "integer", primary: true }, number: { type: "sequence", prefix: "R" } }
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

const withDatabase = (name: string) => {
  const next = new URL(url!);
  next.pathname = `/${name}`;
  return next.toString();
};

describe.skipIf(!url)("a sequence under concurrent writers", () => {
  const database = `osl_sequence_${Date.now().toString(36)}`;
  const TEAMS = 3;
  const WORKERS = 24;
  // A heavier or a replayed load: OSL_SEQUENCE_ROUNDS writes per connection, from OSL_SEQUENCE_SEED
  const ROUNDS = Number(process.env.OSL_SEQUENCE_ROUNDS ?? 40);
  const SEED = Number(process.env.OSL_SEQUENCE_SEED ?? 1);
  const ir = compile(model);
  let admin: pg.Client;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    pool = new pg.Pool({ connectionString: withDatabase(database), max: WORKERS });
    pool.on("error", () => {});
    pool.on("connect", client => client.on("error", () => {}));
    await pool.query(renderPostgres(planMigration(null, ir)));
    await pool.query(`INSERT INTO teams (name) SELECT 'team ' || n FROM generate_series(1, ${TEAMS}) AS n`);
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin?.end();
  });

  /** WORKERS connections each run `rounds` random creates; what failed comes back by SQLSTATE */
  const load = async (seed: number, rounds: number): Promise<Map<string, number>> => {
    const failures = new Map<string, number>();
    await Promise.all(
      Array.from({ length: WORKERS }, async (_, worker) => {
        const next = rng(seed * 1000 + worker);
        for (let round = 0; round < rounds; round++) {
          const team = 1 + Math.floor(next() * TEAMS);
          const dice = next();
          const transaction = async (statements: [string, unknown[]][], end: "COMMIT" | "ROLLBACK") => {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              for (const [sql, args] of statements) await client.query(sql, args);
              await client.query(end);
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            } finally {
              client.release();
            }
          };
          const invoice: [string, unknown[]] = ["INSERT INTO invoices (team_id) VALUES ($1)", [team]];
          const receipt: [string, unknown[]] = ["INSERT INTO receipts DEFAULT VALUES", []];
          let what = "invoice";
          try {
            if (dice < 0.35) await pool.query(...invoice);
            else if (dice < 0.5) {
              what = "receipt";
              await pool.query(...receipt);
            } else if (dice < 0.65) {
              // A create that does not happen: its number goes back to the counter
              what = "rolled back";
              await transaction([invoice, receipt], "ROLLBACK");
            } else if (dice < 0.75) {
              what = "two rows in one statement";
              await pool.query("INSERT INTO invoices (team_id) VALUES ($1), ($1)", [team]);
            } else if (dice < 0.9) {
              // The counter is held across statements, and a second one is taken while it is
              what = "two creates in one transaction";
              await transaction([invoice, invoice, receipt], "COMMIT");
            } else {
              // A number a writer brings is not kept: the database numbers every row
              what = "a number of the writer's own";
              await pool.query("INSERT INTO invoices (team_id, number) VALUES ($1, 'INV-0001')", [team]);
            }
          } catch (error) {
            const key = `${what}: ${(error as { code?: string }).code ?? "unknown"} ${(error as Error).message}`;
            failures.set(key, (failures.get(key) ?? 0) + 1);
          }
        }
      })
    );
    return failures;
  };

  /** Each scope's numbers as counts, in order */
  const numbers = async (): Promise<{ invoices: Map<number, number[]>; receipts: number[] }> => {
    const invoices = new Map<number, number[]>();
    const { rows } = await pool.query<{ team_id: number; number: string }>(
      "SELECT team_id, number FROM invoices ORDER BY team_id, number"
    );
    for (const row of rows) {
      expect(row.number).toMatch(/^INV-\d{4,}$/);
      const list = invoices.get(row.team_id) ?? invoices.set(row.team_id, []).get(row.team_id)!;
      list.push(Number(row.number.slice(4)));
    }
    const receipts = (await pool.query<{ number: string }>("SELECT number FROM receipts")).rows
      .map(row => {
        expect(row.number).toMatch(/^R\d+$/);
        return Number(row.number.slice(1));
      })
      .sort((a, b) => a - b);
    return { invoices, receipts };
  };

  const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("fails no writer, repeats no number and leaves no hole a rollback made", async () => {
    const failures = await load(SEED, ROUNDS);
    expect([...failures.entries()]).toEqual([]);
    const { invoices, receipts } = await numbers();
    expect(invoices.size).toBe(TEAMS);
    for (const [team, list] of invoices) {
      expect(list.length, `team ${team}`).toBeGreaterThan(20);
      expect(list, `team ${team}`).toEqual(upTo(list.length));
    }
    expect(receipts.length).toBeGreaterThan(20);
    expect(receipts).toEqual(upTo(receipts.length));
    // The counters say what the rows say, scope by scope
    const { rows: counters } = await pool.query<{ sequence: string; scope: string; last: string }>(
      'SELECT "sequence", "scope", "last" FROM osl_sequences ORDER BY 1, 2'
    );
    expect(counters).toEqual([
      ...[...invoices.entries()]
        .sort(([a], [b]) => a - b)
        .map(([team, list]) => ({ sequence: "invoices.number", scope: `[${team}]`, last: String(list.length) })),
      { sequence: "receipts.number", scope: "[]", last: String(receipts.length) }
    ]);
    // The count on the same table followed every one of those inserts
    const { rows: teams } = await pool.query<{ id: number; invoice_count: number }>(
      "SELECT id, invoice_count FROM teams ORDER BY id"
    );
    for (const team of teams) expect(team.invoice_count, `team ${team.id}`).toBe(invoices.get(team.id)!.length);
  }, 120_000);

  it("leaves a hole where a row was deleted and keeps the digits of a number past the width", async () => {
    const last = async () =>
      (await pool.query<{ number: string }>("INSERT INTO invoices (team_id) VALUES (1) RETURNING number")).rows[0]
        .number;
    const before = Number((await last()).slice(4));
    await pool.query("DELETE FROM invoices WHERE team_id = 1 AND number = $1", [
      `INV-${String(before).padStart(4, "0")}`
    ]);
    expect(Number((await last()).slice(4))).toBe(before + 1);
    await pool.query(`UPDATE osl_sequences SET "last" = 9999 WHERE "sequence" = 'invoices.number' AND "scope" = '[1]'`);
    expect(await last()).toBe("INV-10000");
    // Put back what the first test left, for the control below
    await pool.query("DELETE FROM invoices WHERE number = 'INV-10000'");
    await pool.query(
      `UPDATE osl_sequences SET "last" = (SELECT max(substring(number from 5)::int) FROM invoices WHERE team_id = 1) WHERE "sequence" = 'invoices.number' AND "scope" = '[1]'`
    );
  });

  it("control: a counter read without holding it gives two creates the same number", async () => {
    const fn = sequenceObjects(ir).find(o => o.name === "osl_sequence_invoices_number")!;
    // What a handler asking for the last number plus one does: read, add, write
    const naive = [
      "DECLARE",
      "  osl_count bigint;",
      "BEGIN",
      `  SELECT "last" INTO osl_count FROM osl_sequences WHERE "sequence" = 'invoices.number' AND "scope" = jsonb_build_array(NEW."team_id")::text;`,
      "  osl_count := coalesce(osl_count, 0) + 1;",
      `  INSERT INTO osl_sequences ("sequence", "scope", "last") VALUES ('invoices.number', jsonb_build_array(NEW."team_id")::text, osl_count)`,
      `  ON CONFLICT ("sequence", "scope") DO UPDATE SET "last" = EXCLUDED."last";`,
      "  NEW.number := 'INV-' || lpad(osl_count::text, greatest(4, length(osl_count::text)), '0');",
      "  RETURN NEW;",
      "END"
    ].join("\n");
    await pool.query(
      `CREATE OR REPLACE FUNCTION "osl_sequence_invoices_number"() RETURNS trigger LANGUAGE plpgsql AS $$\n${naive}\n$$`
    );
    try {
      const failures = await load(SEED + 1, ROUNDS);
      // The unique constraint behind the counter is what turns a repeated number into a failed writer
      const collisions = [...failures.keys()].filter(key => key.includes(" 23505 "));
      expect(collisions.length).toBeGreaterThan(0);
    } finally {
      await pool.query(`CREATE OR REPLACE FUNCTION ${fn.create[0].slice("CREATE FUNCTION ".length)}`);
    }
  }, 120_000);
});

describe.skipIf(!url)("a sequence through migrations", () => {
  const database = `osl_sequence_mig_${Date.now().toString(36)}`;
  let admin: pg.Client;
  let db: pg.Client;

  const entities = (invoice: Record<string, unknown>) => ({
    Team: { fields: { id: { type: "integer", primary: true }, name: { type: "string", required: true } } },
    Invoice: {
      fields: {
        id: { type: "integer", primary: true },
        team_id: { type: "integer", required: true, relation: { entity: "Team", on_delete: "cascade" } },
        ...invoice
      }
    }
  });
  const before = compile(Model.parse({ osl: "1.0", name: "sequence-migrations", entities: entities({}) }));
  const numbered = compile(
    Model.parse({
      osl: "1.0",
      name: "sequence-migrations",
      entities: entities({ number: { type: "sequence", prefix: "INV-", scope: ["team_id"], width: 3 } })
    })
  );
  const renamed = compile(
    Model.parse({
      osl: "1.0",
      name: "sequence-migrations",
      entities: entities({ reference: { type: "sequence", prefix: "INV-", scope: ["team_id"], width: 3 } })
    })
  );

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    db = new pg.Client({ connectionString: withDatabase(database) });
    db.on("error", () => {});
    await db.connect();
    await db.query(renderPostgres(planMigration(null, before)));
    await db.query("INSERT INTO teams (name) VALUES ('A'), ('B')");
    await db.query("INSERT INTO invoices (team_id) VALUES (1), (2), (1), (1), (2)");
  }, 30_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin?.end();
  });

  const all = async (column: string) =>
    (
      await db.query<{ team_id: number; n: string }>(
        `SELECT team_id, ${column} AS n FROM invoices ORDER BY team_id, id`
      )
    ).rows.map(row => `${row.team_id} ${row.n}`);

  it("numbers the rows a table already has, scope by scope, and counts on from them", async () => {
    const plan = planMigration(before, numbered);
    expect(plan.rewrites.map(step => step.kind)).toEqual(["backfill_sequence"]);
    await db.query(renderPostgres(plan));
    expect(await all("number")).toEqual(["1 INV-001", "1 INV-002", "1 INV-003", "2 INV-001", "2 INV-002"]);
    await db.query("INSERT INTO invoices (team_id) VALUES (2), (1)");
    expect(await all("number")).toEqual([
      "1 INV-001",
      "1 INV-002",
      "1 INV-003",
      "1 INV-004",
      "2 INV-001",
      "2 INV-002",
      "2 INV-003"
    ]);
    expect(await checkDrift(withDatabase(database), numbered)).toEqual([]);
  });

  it("keeps the counters of a renamed field", async () => {
    const plan = planMigration(numbered, renamed, { entities: {}, fields: { Invoice: { number: "reference" } } });
    await db.query(renderPostgres(plan));
    await db.query("INSERT INTO invoices (team_id) VALUES (1)");
    expect((await all("reference")).filter(row => row.startsWith("1 ")).at(-1)).toBe("1 INV-005");
    expect(await checkDrift(withDatabase(database), renamed)).toEqual([]);
  });

  it("reports a missing counter table as drift, and drops it with the last sequence", async () => {
    await db.query("ALTER TABLE osl_sequences RENAME TO osl_sequences_gone");
    expect(await checkDrift(withDatabase(database), renamed)).toEqual([
      { kind: "missing_table", table: "osl_sequences" },
      { kind: "extra_table", table: "osl_sequences_gone" }
    ]);
    await db.query("ALTER TABLE osl_sequences_gone RENAME TO osl_sequences");
    await db.query(renderPostgres(planMigration(renamed, before)));
    expect(await checkDrift(withDatabase(database), before)).toEqual([]);
  });
});

/** Teams whose invoices are numbered per team, and tickets numbered across all of them */
const isolated = Model.parse({
  osl: "1.0",
  name: "sequence-guard",
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
    Invoice: {
      fields: {
        id: { type: "uuid", primary: true },
        team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
        number: { type: "sequence", prefix: "INV-", scope: ["team_id"], width: 6 }
      },
      rules: { read: "member:team_id", create: "member:team_id", update: "member:team_id", delete: "member:team_id" }
    },
    Ticket: {
      fields: {
        id: { type: "uuid", primary: true },
        team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
        number: { type: "sequence", prefix: "T-" }
      },
      rules: { read: "member:team_id", create: "member:team_id", update: "member:team_id", delete: "member:team_id" }
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

describe.skipIf(!url)("a sequence under isolation: database", () => {
  const database = `osl_sequence_guard_${Date.now().toString(36)}`;
  const ir = compile(isolated);
  const { appRole, setting } = ir.auth!.tenancy!.isolation!;
  let admin: pg.Client;
  let db: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    db = new pg.Client({ connectionString: withDatabase(database) });
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

  it("warns of the counter that counts across tenants, and not of the one scoped by the tenant", () => {
    const warnings = validateModel(isolated).filter(d => d.code === "M181");
    expect(warnings.map(d => d.path)).toEqual(["entities.Ticket.fields.number.scope"]);
    expect(warnings[0].message).toContain("scope: [team_id]");
  });

  it("numbers the web role's rows without letting it near a counter", async () => {
    const one = async <T>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0] as T;
    const id = async (sql: string, args: unknown[] = []) => (await one<{ id: string }>(sql, args)).id;
    const teamA = await id("INSERT INTO teams (name) VALUES ('A') RETURNING id");
    const teamB = await id("INSERT INTO teams (name) VALUES ('B') RETURNING id");
    const bind = (teams: string[]) => db.query("SELECT set_config($1, $2, false)", [setting, `{${teams.join(",")}}`]);
    const number = async (table: string, team: string) =>
      (await one<{ number: string }>(`INSERT INTO ${table} (team_id) VALUES ($1) RETURNING number`, [team])).number;
    /** As the owner, past the grants: what the counters say */
    const counters = async () => {
      await db.query("RESET ROLE");
      const { rows } = await db.query<{ sequence: string; scope: string; last: string }>(
        'SELECT "sequence", "scope", "last" FROM osl_sequences ORDER BY 1, 2'
      );
      await db.query(`SET ROLE "${appRole}"`);
      // Sorted by the label: the scopes are team ids, random on every run, so the table's own order is no order
      return rows
        .map(
          row => `${row.sequence} ${row.scope === "[]" ? "all" : row.scope === `["${teamA}"]` ? "A" : "B"} ${row.last}`
        )
        .sort();
    };

    // As the role the web process connects as
    await db.query(`SET ROLE "${appRole}"`);
    try {
      await bind([teamA]);
      expect(await number("invoices", teamA)).toBe("INV-000001");
      expect(await number("invoices", teamA)).toBe("INV-000002");
      // The counters are not the web role's to read, to write or to reset, bound or not
      for (const statement of [
        "SELECT * FROM osl_sequences",
        `UPDATE osl_sequences SET "last" = 0`,
        `INSERT INTO osl_sequences VALUES ('invoices.number', '[]', 7)`,
        "DELETE FROM osl_sequences"
      ])
        await expect(db.query(statement)).rejects.toMatchObject({ code: "42501" });
      // Nor is the function that writes them: it is the trigger's alone
      await expect(db.query('SELECT "osl_sequence_invoices_number"()')).rejects.toMatchObject({ code: "42501" });

      // A row the policy refuses takes its counter's step back with it: the other tenant's first number is still 1
      await expect(number("invoices", teamB)).rejects.toMatchObject({ code: "42501" });
      expect(await counters()).toEqual(["invoices.number A 2"]);
      await bind([teamB]);
      expect(await number("invoices", teamB)).toBe("INV-000001");
      // With no tenant bound, no row and no number
      await db.query("SELECT set_config($1, '', false)", [setting]);
      await expect(number("invoices", teamA)).rejects.toMatchObject({ code: "42501" });
      expect(await counters()).toEqual(["invoices.number A 2", "invoices.number B 1"]);

      // The counter M181 warns of: one for every tenant, so B's first ticket tells B that A has made two
      await bind([teamA]);
      expect(await number("tickets", teamA)).toBe("T-1");
      expect(await number("tickets", teamA)).toBe("T-2");
      await bind([teamB]);
      expect(await number("tickets", teamB)).toBe("T-3");

      // Control: under the caller's rights the function cannot reach the counter, and the create fails
      await db.query("RESET ROLE");
      await db.query('ALTER FUNCTION "osl_sequence_invoices_number"() SECURITY INVOKER');
      await db.query(`SET ROLE "${appRole}"`);
      await expect(number("invoices", teamB)).rejects.toMatchObject({ code: "42501" });
      await db.query("RESET ROLE");
      await db.query('ALTER FUNCTION "osl_sequence_invoices_number"() SECURITY DEFINER');
      expect(await checkDrift(withDatabase(database), ir)).toEqual([]);
    } finally {
      await db.query("RESET ROLE");
    }
  }, 30_000);
});
