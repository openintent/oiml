import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyDiff, parseDiff, type Model } from "@osl/core";
import { loadCases } from "../src/cases.js";
import { baseModel, copyOverlay, keptActions } from "../src/runner.js";

const REPO = path.resolve(__dirname, "../../..");

/** Every file under a folder, relative to it, sorted */
async function files(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  await walk(root);
  return out.sort();
}

describe("copyOverlay", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  /** An overlay with action and event handlers in both layouts (a TypeScript file, a Go folder) and a hook */
  async function overlay(): Promise<{ from: string; to: string }> {
    const root = await mkdtemp(path.join(tmpdir(), "osl-overlay-"));
    made.push(root);
    const from = path.join(root, "overlay");
    const write = async (rel: string) => {
      await mkdir(path.dirname(path.join(from, rel)), { recursive: true });
      await writeFile(path.join(from, rel), "// handler\n");
    };
    for (const rel of [
      "hono-trpc-vite/src/actions/posts_publish.ts",
      "hono-trpc-vite/src/actions/integrations_sign.ts",
      "hono-trpc-vite/src/events/post_created.ts",
      "hono-trpc-vite/src/events/integration_created.ts",
      "hono-trpc-vite/src/extensions/posts.ts",
      "gin-pgx/src/actions/posts_publish/handler.go",
      "gin-pgx/src/actions/integrations_sign/handler.go",
      "gin-pgx/src/events/integration_created/handler.go"
    ])
      await write(rel);
    return { from, to: path.join(root, "copy") };
  }

  it("keeps only the action and event handlers the base model declares, and every other file", async () => {
    const { from, to } = await overlay();
    await copyOverlay(from, to, { actions: new Set(["posts_publish"]), events: new Set(["post_created"]) });
    expect(await files(to)).toEqual([
      "gin-pgx/src/actions/posts_publish/handler.go",
      "hono-trpc-vite/src/actions/posts_publish.ts",
      "hono-trpc-vite/src/events/post_created.ts",
      "hono-trpc-vite/src/extensions/posts.ts"
    ]);
  });

  it("copies everything when nothing is kept back (an oracle diff that completes the fixture)", async () => {
    const { from, to } = await overlay();
    await copyOverlay(from, to, null);
    expect(await files(to)).toHaveLength(8);
    expect(await files(to)).toContain("gin-pgx/src/events/integration_created/handler.go");
  });
});

describe("keptActions", () => {
  /** The blog through FEAT-5, which declares posts.publish, posts.unpublish_all and the global send_digest */
  async function blog(): Promise<Model> {
    const c = (await loadCases(path.join(REPO, "evals/propose/cases"))).find(x => x.id === "blog5-overdue-review")!;
    return baseModel(REPO, c);
  }
  /** That base and the diff applied to it */
  async function models(ops: unknown[]): Promise<{ base: Model; proposed: Model }> {
    const base = await blog();
    return { base, proposed: applyDiff(base, parseDiff({ osl: "1.0", ops })).model };
  }
  const ALL = ["posts_publish", "posts_unpublish_all", "send_digest"];
  /** The posts resource with its actions changed by `change` */
  const posts = (base: Model, change: (actions: Record<string, Record<string, unknown>>) => void) => {
    const resource = structuredClone(base.resources.posts) as unknown as {
      actions: Record<string, Record<string, unknown>>;
    };
    change(resource.actions);
    return { op: "update_resource", name: "posts", resource };
  };

  it("keeps the handler of an action the diff leaves alone or restates word for word (the control)", async () => {
    const { base, proposed } = await models([
      { op: "add_field", entity: "Article", name: "stale", field: { type: "boolean" } }
    ]);
    expect([...keptActions(base, proposed)].sort()).toEqual(ALL);
    const restated = await models([posts(base, () => {})]);
    expect([...keptActions(restated.base, restated.proposed)].sort()).toEqual(ALL);
  });

  it("drops the handler of an action the diff declares differently, so --implement writes it", async () => {
    const base = await blog();
    const described = await models([
      posts(base, actions => {
        actions.publish.description = "Mark the article published and clear its stale mark";
      })
    ]);
    expect([...keptActions(described.base, described.proposed)].sort()).toEqual(["posts_unpublish_all", "send_digest"]);
    const ruled = await models([
      posts(base, actions => {
        actions.publish.rule = "role:admin";
      })
    ]);
    expect([...keptActions(ruled.base, ruled.proposed)].sort()).toEqual(["posts_unpublish_all", "send_digest"]);
  });

  it("never keeps a handler for an action the base does not declare", async () => {
    const base = await blog();
    const added = await models([
      posts(base, actions => {
        actions.mark_stale = { description: "Mark it stale", rule: "none" };
      })
    ]);
    expect([...keptActions(added.base, added.proposed)].sort()).toEqual(ALL);
  });
});
