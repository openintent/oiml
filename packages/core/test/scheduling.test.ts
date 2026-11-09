import { describe, expect, it } from "vitest";
import { DiffError, Model, applyDiff, compile, parseDiff, validateModel } from "../src/index.js";

/** Articles publish themselves; a digest goes out every morning */
const base: Model = Model.parse({
  osl: "1.0",
  name: "demo",
  entities: {
    User: {
      fields: {
        id: { type: "uuid", primary: true },
        email: { type: "string", required: true, unique: true },
        name: { type: "string", required: true }
      }
    },
    Article: {
      fields: {
        id: { type: "uuid", primary: true },
        title: { type: "string", required: true },
        published: { type: "boolean", required: true, default: false },
        publish_at: { type: "datetime" },
        author_id: { type: "uuid", required: true, relation: { entity: "User" } }
      },
      rules: { read: "public", create: "owner:author_id", update: "owner:author_id" }
    }
  },
  auth: { identity: "User", provider: "credentials" },
  resources: {
    posts: {
      entity: "Article",
      operations: ["list", "get", "create", "update"],
      actions: {
        publish: { rule: "owner:author_id" },
        archive_old: {
          scope: "collection",
          rule: "authenticated",
          returns: { count: { type: "integer", required: true } }
        }
      }
    }
  },
  actions: {
    send_digest: {
      input: { subject: { type: "string", required: true } },
      returns: { sent: { type: "integer", required: true } }
    }
  },
  schedules: [
    { cron: "0 7 * * *", run: "actions.send_digest", input: { subject: "Weekly" } },
    { cron: "*/15 * * * *", run: "posts.archive_old" }
  ],
  timers: [{ on: "Article", at: "publish_at", run: "posts.publish", when: "published = false" }],
  examples: {
    actors: { alice: { email: "alice@example.com", password: "alice-pass-1", name: "Alice" } },
    scenarios: [
      {
        name: "publishing",
        steps: [
          { op: "timers.run", body: { now: "{now+2d}" }, expect: { status: 200 } },
          { op: "schedules.run", body: { run: "actions.send_digest", now: "{now}" }, expect: { status: 200 } },
          { op: "emails.sent", query: { to: "alice@example.com" }, expect: { status: 200 } }
        ]
      }
    ]
  }
});

const codes = (m: unknown) => validateModel(Model.parse(m)).map(d => `${d.code}:${d.path}`);
const withTimers = (timers: unknown[]) => ({ ...base, timers });
const withSchedules = (schedules: unknown[]) => ({ ...base, schedules });

describe("schedules and timers", () => {
  it("compile onto the queue with the action they run", () => {
    expect(validateModel(base).filter(d => d.level === "error")).toEqual([]);
    const ir = compile(base);
    expect(ir.jobs).toEqual({ queue: true });
    expect(ir.schedules.map(s => [s.name, s.cron, s.run.handler, s.input])).toEqual([
      ["send_digest", "0 7 * * *", "send_digest", { subject: "Weekly" }],
      ["posts_archive_old", "*/15 * * * *", "posts_archive_old", {}]
    ]);
    expect(ir.timers).toEqual([
      {
        name: "article_publish_at",
        entity: "Article",
        table: "articles",
        column: "publish_at",
        afterSeconds: 0,
        run: { resource: "posts", action: "publish", handler: "posts_publish" },
        when: { column: "published", op: "eq", value: false }
      }
    ]);
    const steps = ir.examples.scenarios[0].steps;
    expect(steps.map(s => [s.kind, s.method, s.pathTemplate])).toEqual([
      ["timer", "POST", "/api/osl-hooks/timers/run"],
      ["schedule", "POST", "/api/osl-hooks/schedules/run"],
      ["email", "GET", "/api/osl-hooks/emails"]
    ]);
  });

  it("turn durations into seconds and name a second timer on the same field", () => {
    const ir = compile(
      Model.parse(
        withTimers([
          { on: "Article", at: "publish_at", run: "posts.publish" },
          { on: "Article", at: "publish_at", after: "48h", run: "posts.publish", when: "published = true" }
        ])
      )
    );
    expect(ir.timers.map(t => [t.name, t.afterSeconds])).toEqual([
      ["article_publish_at", 0],
      ["article_publish_at_2", 172800]
    ]);
  });

  it("refuse crons, actions and fields that do not fit (M130 to M136)", () => {
    expect(
      codes(withSchedules([{ cron: "61 7 * * *", run: "actions.send_digest", input: { subject: "x" } }]))
    ).toContain("M130:schedules[0].cron");
    expect(codes(withSchedules([{ cron: "0 7 * * *", run: "actions.send_digest" }]))).toContain(
      "M131:schedules[0].input"
    );
    expect(codes(withSchedules([{ cron: "0 7 * * *", run: "posts.publish" }]))).toContain("M131:schedules[0].run");
    expect(codes(withSchedules([{ cron: "0 7 * * *", run: "actions.nothing" }]))).toContain("M131:schedules[0].run");
    expect(codes(withTimers([{ on: "Article", at: "title", run: "posts.publish" }]))).toContain("M132:timers[0].at");
    expect(codes(withTimers([{ on: "Article", at: "publish_at", run: "posts.archive_old" }]))).toContain(
      "M133:timers[0].run"
    );
    expect(
      codes(withTimers([{ on: "Article", at: "publish_at", run: "posts.publish", when: "published = maybe" }]))
    ).toContain("M033:timers[0].when");
    const noTimers = Model.parse({ ...base, timers: [] });
    expect(validateModel(noTimers).map(d => d.code)).toContain("M135");
    const badRun = Model.parse({
      ...base,
      examples: {
        ...base.examples,
        scenarios: [
          {
            name: "x",
            steps: [{ op: "schedules.run", body: { run: "actions.nope" }, expect: { status: 200 } }]
          }
        ]
      }
    });
    expect(validateModel(badRun).map(d => d.code)).toContain("M136");
  });

  it("follow renames and refuse removals through diffs", () => {
    const renamed = applyDiff(
      base,
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Article", from: "publish_at", to: "go_live_at" }] })
    ).model;
    expect(renamed.timers[0].at).toBe("go_live_at");
    const renamedWhen = applyDiff(
      base,
      parseDiff({ osl: "1.0", ops: [{ op: "rename_field", entity: "Article", from: "published", to: "live" }] })
    ).model;
    expect(renamedWhen.timers[0].when).toBe("live = false");
    expect(() =>
      applyDiff(base, parseDiff({ osl: "1.0", ops: [{ op: "remove_field", entity: "Article", name: "publish_at" }] }))
    ).toThrow(DiffError);
    expect(() =>
      applyDiff(base, parseDiff({ osl: "1.0", ops: [{ op: "remove_action", name: "send_digest" }] }))
    ).toThrow(DiffError);
    const cleared = applyDiff(
      base,
      parseDiff({
        osl: "1.0",
        ops: [
          { op: "set_schedules", schedules: [] },
          { op: "set_timers", timers: [] }
        ]
      })
    ).model;
    expect(cleared.schedules).toEqual([]);
    expect(cleared.timers).toEqual([]);
  });
});
