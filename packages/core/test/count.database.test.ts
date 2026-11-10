/**
 * The counts' database objects under concurrent writers, on a real PostgreSQL. Runs when OSL_TEST_DATABASE_URL is
 * set (the conformance run's variable) and is skipped without it, like the harness itself.
 *
 * Many connections at once add comments to a few posts, delete them one by one and several at a time, flip the
 * field a count's `where` reads, move comments from one post to another, and write several posts in one statement.
 * No statement may fail, and when the writers are done every post says exactly as many comments as it has, for the
 * plain count and for the one with a condition. The control writes the same increments from a value read before
 * the row was held, and expects counts that are wrong. The whole suite runs again with a sequence on the counted
 * table, whose trigger takes a counter inside every insert.
 *
 * A second load adds the two writers a count cannot order, because they hold the counting row first and ask for a
 * counted row second, while every writer of a counted row holds that row first and asks for the counting row second:
 * a delete of a post (its comments go by cascade), and a transaction of the caller's own that writes a comment and
 * then another comment of the same post. PostgreSQL ends such a pair by failing one of the two (deadlock_detected),
 * which that load allows; whatever fails, the counts that remain are exact. Where the counted rows are ordered
 * within the counting row, the order's lock closes the second case: order.database.test.ts runs it with a count in
 * place and no writer fails.
 *
 * The last suite is the count under `isolation: database`: written by the app role with the tenant of the counted
 * row bound, with another tenant bound and with none, onto a tenant's row and onto a shared one.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Model, checkDrift, compile, countObjects, planMigration, renderPostgres } from "../src/index.js";

const url = process.env.OSL_TEST_DATABASE_URL;

const model = Model.parse({
  osl: "1.0",
  name: "count-stress",
  entities: {
    Post: {
      fields: {
        id: { type: "integer", primary: true },
        title: { type: "string", required: true },
        comment_count: { type: "integer", count_of: "comments" },
        approved_count: { type: "integer", count_of: "comments", where: "approved = true" }
      }
    },
    Comment: {
      fields: {
        id: { type: "integer", primary: true },
        post_id: {
          type: "integer",
          required: true,
          relation: { entity: "Post", reverse: "comments", on_delete: "cascade" }
        },
        approved: { type: "boolean", required: true, default: false }
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

const withDatabase = (name: string) => {
  const next = new URL(url!);
  next.pathname = `/${name}`;
  return next.toString();
};

/**
 * The same posts with a number on every comment, one counter for the table (`type: sequence`, sequences.ts): each
 * insert takes the counter before the count's triggers write the post. The counter is not scoped by the post
 * because the load moves comments between posts, and a row keeps the number it was given.
 */
const numbered = Model.parse({
  ...model,
  entities: {
    ...model.entities,
    Comment: { fields: { ...model.entities.Comment.fields, number: { type: "sequence", prefix: "C-" } } }
  }
});

describe.skipIf(!url).each([
  { title: "", model, tag: "" },
  { title: ", with a sequence on the counted table", model: numbered, tag: "sequence_" }
])("a count under concurrent writers$title", ({ model, tag }) => {
  const database = `osl_count_${tag}${Date.now().toString(36)}`;
  const POSTS = 4;
  const WORKERS = 24;
  // A heavier or a replayed load: OSL_COUNT_ROUNDS writes per connection, from OSL_COUNT_SEED
  const ROUNDS = Number(process.env.OSL_COUNT_ROUNDS ?? 60);
  const SEED = Number(process.env.OSL_COUNT_SEED ?? 1);
  let admin: pg.Client;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    pool = new pg.Pool({ connectionString: withDatabase(database), max: WORKERS });
    pool.on("error", () => {});
    pool.on("connect", client => client.on("error", () => {}));
    await pool.query(renderPostgres(planMigration(null, compile(model))));
    await pool.query(`INSERT INTO posts (title) SELECT 'post ' || n FROM generate_series(1, ${POSTS}) AS n`);
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin?.end();
  });

  /** The posts whose counts are not the rows they have */
  const wrong = async () =>
    (
      await pool.query<{ id: number; said: number; has: number; said_approved: number; has_approved: number }>(
        `SELECT p.id, p.comment_count AS said, (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id) AS has,
                p.approved_count AS said_approved,
                (SELECT count(*)::int FROM comments c WHERE c.post_id = p.id AND c.approved) AS has_approved
         FROM posts p ORDER BY p.id`
      )
    ).rows.filter(row => row.said !== row.has || row.said_approved !== row.has_approved);

  /** WORKERS connections each run `rounds` random writes; what failed comes back by SQLSTATE */
  const load = async (seed: number, rounds: number, parentFirst: boolean): Promise<Map<string, number>> => {
    const failures = new Map<string, number>();
    await Promise.all(
      Array.from({ length: WORKERS }, async (_, worker) => {
        const next = rng(seed * 1000 + worker);
        const pick = (n: number) => 1 + Math.floor(next() * n);
        for (let round = 0; round < rounds; round++) {
          const post = pick(POSTS);
          const dice = next();
          const some = `(SELECT id FROM comments WHERE post_id = ${post} ORDER BY random() LIMIT 1)`;
          let what = "insert";
          try {
            if (parentFirst && dice < 0.06) {
              // The parent goes, its comments with it by cascade, and comes back empty
              what = "delete post";
              await pool.query("DELETE FROM posts WHERE id = $1", [post]);
              await pool.query(
                "INSERT INTO posts (id, title) OVERRIDING SYSTEM VALUE VALUES ($1, 'again') ON CONFLICT DO NOTHING",
                [post]
              );
            } else if (dice < 0.4) {
              await pool.query("INSERT INTO comments (post_id, approved) VALUES ($1, $2)", [post, next() < 0.5]);
            } else if (dice < 0.55) {
              what = "delete";
              await pool.query(`DELETE FROM comments WHERE id = ${some}`);
            } else if (dice < 0.7) {
              // The field the condition reads: the row enters or leaves the count that has one
              what = "update";
              await pool.query(`UPDATE comments SET approved = NOT approved WHERE id = ${some}`);
            } else if (dice < 0.8) {
              // The row goes to another post: one count falls and another rises in one statement
              what = "move";
              await pool.query(`UPDATE comments SET post_id = $1 WHERE id = ${some}`, [pick(POSTS)]);
            } else if (dice < 0.88) {
              // Several rows of one post leave in one statement
              what = "delete several";
              await pool.query("DELETE FROM comments WHERE post_id = $1 AND id % 5 = $2", [post, pick(5) - 1]);
            } else if (dice < 0.95 || !parentFirst) {
              // One statement adds rows to every post: the counts are written post by post, in key order
              what = "insert everywhere";
              await pool.query(
                `INSERT INTO comments (post_id, approved) SELECT p.id, true FROM posts p ORDER BY ${next() < 0.5 ? "p.id" : "p.id DESC"}`
              );
            } else {
              // Two writes to one post in one transaction: the post is held from the first, a comment asked for by the second
              what = "two writes";
              const client = await pool.connect();
              try {
                await client.query("BEGIN");
                await client.query("INSERT INTO comments (post_id) VALUES ($1)", [post]);
                await client.query(`DELETE FROM comments WHERE id = ${some}`);
                await client.query("COMMIT");
              } catch (error) {
                await client.query("ROLLBACK");
                throw error;
              } finally {
                client.release();
              }
            }
          } catch (error) {
            const key = `${what}: ${(error as { code?: string }).code ?? "unknown"}`;
            failures.set(key, (failures.get(key) ?? 0) + 1);
          }
        }
      })
    );
    return failures;
  };

  it("fails no writer and leaves every count equal to its rows", async () => {
    const failures = await load(SEED, ROUNDS, false);
    expect([...failures.entries()]).toEqual([]);
    expect(await wrong()).toEqual([]);
    expect((await pool.query("SELECT count(*)::int AS n FROM comments")).rows[0].n).toBeGreaterThan(0);
  }, 120_000);

  it("stays exact among writers that hold a post before its comments, whoever the database fails", async () => {
    const failures = await load(SEED + 1, Math.min(ROUNDS, 15), true);
    // A comment for a post that has just gone (23503), and the race a count adds: a holder of the post that asks
    // for a comment against a writer of that comment, which PostgreSQL ends by failing one of them (40P01)
    const unearned = [...failures.keys()].filter(key => !/: (40P01|23503)$/.test(key));
    expect(unearned).toEqual([]);
    expect(await wrong()).toEqual([]);
  }, 180_000);

  it("is emptied with its table", async () => {
    await pool.query("TRUNCATE comments");
    expect(await wrong()).toEqual([]);
    const { rows } = await pool.query<{ n: number }>("SELECT sum(comment_count + approved_count)::int AS n FROM posts");
    expect(rows[0].n).toBe(0);
  });

  // With the sequence the control has nothing to show: one counter for the table makes every insert wait for the
  // one before it to commit, so two inserts never read the count at once, however carelessly it is written
  it.skipIf(tag !== "")(
    "control: an increment from a value read before the row was held loses writes",
    async () => {
      await pool.query("TRUNCATE comments");
      const fn = countObjects(compile(model)).find(o => o.name === "osl_count_posts_comment_count")!;
      // The same function, except that it adds to what a query saw before the write waited for the row
      const stale = fn.body!.source.replaceAll(
        '"comment_count" = "comment_count" + osl_delta.n',
        '"comment_count" = (SELECT s."comment_count" FROM "posts" AS s WHERE s."id" = osl_delta.parent) + osl_delta.n'
      );
      expect(stale).not.toBe(fn.body!.source);
      await pool.query(
        `CREATE OR REPLACE FUNCTION osl_count_posts_comment_count() RETURNS trigger LANGUAGE plpgsql AS $$\n${stale}\n$$`
      );
      await Promise.all(
        Array.from({ length: WORKERS * 10 }, () => pool.query("INSERT INTO comments (post_id) VALUES (1)"))
      );
      const { rows } = await pool.query<{ said: number; has: number }>(
        "SELECT comment_count AS said, (SELECT count(*)::int FROM comments WHERE post_id = 1) AS has FROM posts WHERE id = 1"
      );
      expect(rows[0].has).toBe(WORKERS * 10);
      // Two inserts read the same number and both wrote it plus one: the count is short
      expect(rows[0].said).toBeLessThan(rows[0].has);
    },
    60_000
  );
});

describe.skipIf(!url)("a count that arrives on a table with rows", () => {
  const database = `osl_count_fill_${Date.now().toString(36)}`;
  let admin: pg.Client;
  let db: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    db = new pg.Client({ connectionString: withDatabase(database) });
    db.on("error", () => {});
    await db.connect();
  }, 30_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin?.end();
  });

  it("is counted by the migration that adds it, counted again when its condition changes, and kept from there", async () => {
    const raw = JSON.parse(JSON.stringify(model)) as { entities: { Post: { fields: Record<string, unknown> } } };
    const without = structuredClone(raw);
    delete without.entities.Post.fields.comment_count;
    delete without.entities.Post.fields.approved_count;
    const before = compile(Model.parse(without));
    const after = compile(model);
    const said = async () =>
      (
        await db.query<{ comment_count: number; approved_count: number }>(
          "SELECT comment_count, approved_count FROM posts ORDER BY id"
        )
      ).rows.map(row => `${row.comment_count}/${row.approved_count}`);

    await db.query(renderPostgres(planMigration(null, before)));
    await db.query("INSERT INTO posts (title) VALUES ('one'), ('two'), ('three')");
    await db.query("INSERT INTO comments (post_id, approved) VALUES (1, true), (1, true), (1, false), (3, false)");
    // The fields arrive: the rows that exist are counted before the triggers that keep the number are made
    await db.query(renderPostgres(planMigration(before, after)));
    expect(await said()).toEqual(["3/2", "0/0", "1/0"]);
    await db.query("INSERT INTO comments (post_id, approved) VALUES (2, true)");
    await db.query("UPDATE comments SET approved = true WHERE post_id = 3");
    expect(await said()).toEqual(["3/2", "1/1", "1/1"]);

    // The condition changes: the function is made again around it and the rows are counted again
    const flipped = structuredClone(raw);
    (flipped.entities.Post.fields.approved_count as { where: string }).where = "approved = false";
    const changed = compile(Model.parse(flipped));
    await db.query(renderPostgres(planMigration(after, changed)));
    expect(await said()).toEqual(["3/1", "1/0", "1/0"]);
    await db.query("DELETE FROM comments WHERE post_id = 1 AND NOT approved");
    expect(await said()).toEqual(["2/0", "1/0", "1/0"]);

    // The live database is what the model says: the functions and triggers are compared by the drift check
    expect(await checkDrift(withDatabase(database), changed)).toEqual([]);
    await db.query('DROP TRIGGER "osl_count_posts_comment_count_del" ON comments');
    expect((await checkDrift(withDatabase(database), changed)).map(item => `${item.kind} ${item.name}`)).toEqual([
      "missing_trigger osl_count_posts_comment_count_del"
    ]);
  }, 30_000);
});

/**
 * Teams with projects that count their tasks (a tenant's rows counted on a tenant's row), users that count the
 * tasks assigned to them (tenants' rows counted on a shared row), and mentions any signed-in user writes about a
 * project (a shared table's rows counted on a tenant's row).
 */
const isolated = Model.parse({
  osl: "1.0",
  name: "count-guard",
  entities: {
    User: {
      fields: {
        id: { type: "uuid", primary: true },
        email: { type: "string", required: true, unique: true },
        assigned_count: { type: "integer", count_of: "assigned" }
      },
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
        name: { type: "string", required: true },
        task_count: { type: "integer", count_of: "tasks" },
        mention_count: { type: "integer", count_of: "mentions" }
      },
      rules: { read: "member:team_id", create: "member:team_id", update: "member:team_id", delete: "member:team_id" }
    },
    Task: {
      fields: {
        id: { type: "uuid", primary: true },
        project_id: {
          type: "uuid",
          required: true,
          relation: { entity: "Project", reverse: "tasks", on_delete: "cascade" }
        },
        assignee_id: { type: "uuid", relation: { entity: "User", reverse: "assigned", on_delete: "set_null" } },
        title: { type: "string", required: true }
      },
      rules: {
        read: "member:project_id.team_id",
        create: "member:project_id.team_id",
        update: "member:project_id.team_id",
        delete: "member:project_id.team_id"
      }
    },
    Mention: {
      fields: {
        id: { type: "uuid", primary: true },
        project_id: { type: "uuid", relation: { entity: "Project", reverse: "mentions", on_delete: "set_null" } },
        text: { type: "string", required: true }
      },
      rules: { read: "authenticated", create: "authenticated", update: "none", delete: "authenticated" }
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

describe.skipIf(!url)("a count under isolation: database", () => {
  const database = `osl_count_guard_${Date.now().toString(36)}`;
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

  it("is written whoever the caller is bound to, and tells the caller nothing", async () => {
    const one = async <T>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0] as T;
    const id = async (sql: string, args: unknown[] = []) => (await one<{ id: string }>(sql, args)).id;
    const user = await id("INSERT INTO users (email) VALUES ('u@example.com') RETURNING id");
    const teamA = await id("INSERT INTO teams (name) VALUES ('A') RETURNING id");
    const teamB = await id("INSERT INTO teams (name) VALUES ('B') RETURNING id");
    const projectA = await id("INSERT INTO projects (team_id, name) VALUES ($1, 'PA') RETURNING id", [teamA]);
    const projectB = await id("INSERT INTO projects (team_id, name) VALUES ($1, 'PB') RETURNING id", [teamB]);
    const bind = (teams: string[]) => db.query("SELECT set_config($1, $2, false)", [setting, `{${teams.join(",")}}`]);
    /** As the owner, past the policies: what the rows say */
    const said = async () => {
      await db.query("RESET ROLE");
      const projects = (
        await db.query<{ name: string; task_count: number; mention_count: number }>(
          "SELECT name, task_count, mention_count FROM projects ORDER BY name"
        )
      ).rows.map(r => `${r.name} ${r.task_count} tasks ${r.mention_count} mentions`);
      const assigned = (await one<{ n: number }>("SELECT assigned_count AS n FROM users WHERE id = $1", [user])).n;
      await db.query(`SET ROLE "${appRole}"`);
      return { projects, assigned };
    };

    // As the role the web process connects as: the policies bind it, the count's functions run with their owner's rights
    await db.query(`SET ROLE "${appRole}"`);
    try {
      // A tenant's row counted on a row of the same tenant, by a caller bound to it
      await bind([teamA]);
      await db.query("INSERT INTO tasks (project_id, assignee_id, title) VALUES ($1, $2, 'a1')", [projectA, user]);
      await db.query("INSERT INTO tasks (project_id, title) VALUES ($1, 'a2')", [projectA]);
      expect(await said()).toEqual({ projects: ["PA 2 tasks 0 mentions", "PB 0 tasks 0 mentions"], assigned: 1 });
      // The backstop still holds for the counted rows themselves: another tenant's project takes no task of this caller
      await expect(
        db.query("INSERT INTO tasks (project_id, title) VALUES ($1, 'b0')", [projectB])
      ).rejects.toMatchObject({ code: "42501" });
      expect((await said()).projects[1]).toBe("PB 0 tasks 0 mentions");

      // Tenants' rows counted on a shared row: the user's number adds up the tasks of every team
      await bind([teamB]);
      await db.query("INSERT INTO tasks (project_id, assignee_id, title) VALUES ($1, $2, 'b1')", [projectB, user]);
      expect(await said()).toEqual({ projects: ["PA 2 tasks 0 mentions", "PB 1 tasks 0 mentions"], assigned: 2 });

      // A shared table's row counted on a tenant's row the caller is not bound to: the caller reads no such project,
      // and the count is written all the same
      expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM projects WHERE id = $1", [projectA])).n).toBe(0);
      const written = await db.query("INSERT INTO mentions (project_id, text) VALUES ($1, 'seen from B') RETURNING *", [
        projectA
      ]);
      // What comes back is the caller's own row and nothing of the project
      expect(Object.keys(written.rows[0] as object).sort()).toEqual(["id", "project_id", "text"]);
      expect((await said()).projects[0]).toBe("PA 2 tasks 1 mentions");
      // With no tenant bound at all
      await db.query("SELECT set_config($1, '', false)", [setting]);
      await db.query("INSERT INTO mentions (project_id, text) VALUES ($1, 'seen from nowhere')", [projectA]);
      await db.query("DELETE FROM mentions WHERE text = 'seen from B'");
      expect((await said()).projects[0]).toBe("PA 2 tasks 1 mentions");

      // The functions are the triggers' alone
      await expect(db.query('SELECT "osl_count_projects_task_count"()')).rejects.toMatchObject({ code: "42501" });

      // Control: under the caller's rights the policy hides the project from the count's own write, and the number
      // is wrong without a word
      await db.query("RESET ROLE");
      await db.query('ALTER FUNCTION "osl_count_projects_mention_count"() SECURITY INVOKER');
      await db.query(`SET ROLE "${appRole}"`);
      await bind([teamB]);
      await db.query("INSERT INTO mentions (project_id, text) VALUES ($1, 'lost')", [projectA]);
      expect((await said()).projects[0]).toBe("PA 2 tasks 1 mentions");
      await db.query("RESET ROLE");
      expect(
        (await one<{ n: number }>("SELECT count(*)::int AS n FROM mentions WHERE project_id = $1", [projectA])).n
      ).toBe(2);
    } finally {
      await db.query("RESET ROLE");
    }
  }, 30_000);
});
