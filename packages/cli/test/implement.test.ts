import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyIntent, generateProject, initProject, listIntents } from "@osl/core";
import { backendNamed } from "../src/backends.js";
import { planHandlers, userPrompt } from "../src/implement.js";

const FIXTURE = path.resolve(__dirname, "../../../fixtures/blog");

/** The blog fixture generated for a backend, with every handler still at its stub */
async function generatedBlog(backend: string) {
  const root = await mkdtemp(path.join(tmpdir(), "osl-implement-"));
  await initProject(root, { name: "blog", backend });
  await cp(path.join(FIXTURE, "intents"), path.join(root, ".osl/intents"), { recursive: true });
  for (const id of await listIntents(root)) await applyIntent(root, id);
  await generateProject(root, backendNamed(backend));
  return root;
}

describe("implement planning", () => {
  it("plans every stub with its declaration, scenarios and the stack's files", async () => {
    const backend = backendNamed("hono-trpc-vite");
    const root = await generatedBlog(backend.name);
    const plan = await planHandlers(root, backend);
    expect(plan.handlers.map(h => h.action.handler).sort()).toEqual([
      "announcements_publish",
      "posts_lock",
      "posts_publish",
      "posts_unlock",
      "posts_unpublish_all",
      "send_digest",
      "users_ban"
    ]);
    expect(plan.handlers.every(h => h.isStub)).toBe(true);
    expect(plan.system).toContain("hono-trpc-vite");
    expect(plan.system).toContain("fail(status, code, message)");

    const ban = plan.handlers.find(h => h.action.handler === "users_ban")!;
    expect(ban.path).toBe("src/actions/users_ban.ts");
    const prompt = userPrompt(ban);
    expect(prompt).toContain("Action users.ban: POST /api/users/{id}/ban");
    expect(prompt).toContain("rule: role:admin");
    expect(prompt).toContain("read_only: true");
    expect(prompt).toContain("name: banning");
    expect(prompt).toContain("ban_reason: Spam");
    expect(prompt).toContain("export async function handler(ctx: ActionContext<UsersBanInput, User>)");
    expect(prompt).toContain("### generated/db/schema.ts");
    expect(prompt).toContain("### generated/server/errors.ts");
    expect(prompt).not.toContain("Your previous file");

    const retry = userPrompt(ban, { source: "broken", problems: ["tsc exited 2", "error TS2304"] });
    expect(retry).toContain("Your previous file did not pass the check");
    expect(retry).toContain("error TS2304");

    // A global action without an entity sees every entity
    const digest = plan.handlers.find(h => h.action.handler === "send_digest")!;
    expect(digest.entities).toContain("Article:");
    expect(digest.entities).toContain("User:");
    expect(userPrompt(digest)).toContain("Scenarios that call it");
  });

  it("leaves handlers that are no longer stubs alone unless forced, and narrows to the named ones", async () => {
    const backend = backendNamed("gin-pgx");
    const root = await generatedBlog(backend.name);
    await writeFile(path.join(root, "src/actions/posts_publish/handler.go"), "package postspublish\n");
    const plan = await planHandlers(root, backend);
    expect(plan.handlers.map(h => h.action.handler).sort()).toEqual([
      "announcements_publish",
      "posts_lock",
      "posts_unlock",
      "posts_unpublish_all",
      "send_digest",
      "users_ban"
    ]);
    expect(plan.handlers[0].path).toMatch(/^src\/actions\/.*\/handler\.go$/);
    expect(plan.guide.language).toBe("go");
    expect(plan.handlers[0].files.map(f => f.path)).toEqual([
      "generated/actions/actions.go",
      "generated/models/entities.go",
      "generated/httpx/httpx.go",
      "generated/email/email.go"
    ]);

    const forced = await planHandlers(root, backend, { force: true, only: ["posts_publish"] });
    expect(forced.handlers.map(h => h.action.handler)).toEqual(["posts_publish"]);
    expect(forced.handlers[0].isStub).toBe(false);
  });
});
