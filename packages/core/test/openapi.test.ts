import { mkdtemp, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyIntent, initProject, listIntents, loadProject, openapiDocument } from "../src/index.js";

const FIXTURES = path.resolve(__dirname, "../../../fixtures");

async function irFor(fixture: string) {
  const root = await mkdtemp(path.join(tmpdir(), `osl-openapi-`));
  await initProject(root, { name: fixture, backend: "drizzle-next" });
  await cp(path.join(FIXTURES, fixture, "intents"), path.join(root, ".osl/intents"), { recursive: true });
  for (const id of await listIntents(root)) await applyIntent(root, id);
  return (await loadProject(root)).ir;
}

describe("openapi document", () => {
  it("describes the blog's REST contract", async () => {
    const doc = openapiDocument(await irFor("blog")) as {
      openapi: string;
      paths: Record<
        string,
        Record<string, { operationId: string; parameters?: { name: string }[]; responses: Record<string, unknown> }>
      >;
      components: { schemas: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual([
      "/api/actions/send_digest",
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/magic-link",
      "/api/auth/magic-link/verify",
      "/api/auth/me",
      "/api/auth/oauth/github",
      "/api/auth/oauth/github/callback",
      "/api/auth/providers",
      "/api/auth/register",
      "/api/comments",
      "/api/comments/{id}",
      "/api/files",
      "/api/files/{id}",
      "/api/files/{id}/complete",
      "/api/files/{id}/content",
      "/api/posts",
      "/api/posts/{id}",
      "/api/posts/{id}/lock",
      "/api/posts/{id}/publish",
      "/api/posts/{id}/unlock",
      "/api/posts/unpublish_all",
      "/api/users",
      "/api/users/{id}",
      "/api/users/{id}/ban"
    ]);
    const list = doc.paths["/api/posts"].get;
    expect(list.operationId).toBe("posts_list");
    expect(list.parameters!.map(p => p.name)).toEqual(["page", "page_size", "published", "author_id", "sort", "q"]);
    expect(doc.paths["/api/posts/{id}/publish"].post.operationId).toBe("posts_publish");
    expect(Object.keys(doc.paths["/api/posts/{id}/publish"].post.responses)).toContain("200");
    expect(Object.keys(doc.paths["/api/posts/{id}"].delete.responses)).toContain("204");
    expect(Object.keys(doc.components.schemas)).toEqual(["Article", "Comment", "Error", "File", "User"]);
    expect(doc.components.securitySchemes).toBeDefined();
    // Stable: the same IR gives the same document
    expect(JSON.stringify(doc)).toBe(JSON.stringify(openapiDocument(await irFor("blog"))));
  });
});
