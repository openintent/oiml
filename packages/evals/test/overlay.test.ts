import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyOverlay } from "../src/runner.js";

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
