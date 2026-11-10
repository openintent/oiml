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
      "/api/announcements",
      "/api/announcements/{id}",
      "/api/announcements/{id}/publish",
      "/api/article_editors",
      "/api/article_editors/{id}",
      "/api/article_invites",
      "/api/article_invites/{id}",
      "/api/attachments",
      "/api/attachments/{id}",
      "/api/auth/invites/{token}",
      "/api/auth/invites/{token}/accept",
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/magic-link",
      "/api/auth/magic-link/verify",
      "/api/auth/me",
      "/api/auth/oauth/github",
      "/api/auth/oauth/github/callback",
      "/api/auth/providers",
      "/api/auth/register",
      "/api/bulletins",
      "/api/bulletins/{id}",
      "/api/comments",
      "/api/comments/{id}",
      "/api/files",
      "/api/files/{id}",
      "/api/files/{id}/complete",
      "/api/files/{id}/content",
      "/api/follows",
      "/api/follows/{id}",
      "/api/integrations",
      "/api/integrations/{id}",
      "/api/integrations/{id}/sign",
      "/api/posts",
      "/api/posts/{id}",
      "/api/posts/{id}/approve",
      "/api/posts/{id}/archive",
      "/api/posts/{id}/lock",
      "/api/posts/{id}/publish",
      "/api/posts/{id}/reject",
      "/api/posts/{id}/restore",
      "/api/posts/{id}/retire",
      "/api/posts/{id}/submit",
      "/api/posts/{id}/unlock",
      "/api/posts/unpublish_all",
      "/api/users",
      "/api/users/{id}",
      "/api/users/{id}/ban"
    ]);
    const list = doc.paths["/api/posts"].get;
    expect(list.operationId).toBe("posts_list");
    expect(list.parameters!.map(p => p.name)).toEqual([
      "page",
      "page_size",
      "published",
      "author_id",
      "status",
      "archived",
      "sort",
      "q"
    ]);
    expect(doc.paths["/api/posts/{id}/publish"].post.operationId).toBe("posts_publish");
    expect(Object.keys(doc.paths["/api/posts/{id}/publish"].post.responses)).toContain("200");
    expect(Object.keys(doc.paths["/api/posts/{id}"].delete.responses)).toContain("204");
    expect(Object.keys(doc.components.schemas)).toEqual([
      "AcceptedInvite",
      "Announcement",
      "Article",
      "ArticleEditor",
      "ArticleInvite",
      "Attachment",
      "Bulletin",
      "Comment",
      "Error",
      "File",
      "Follow",
      "Integration",
      "User"
    ]);
    expect(doc.components.securitySchemes).toBeDefined();
    // Stable: the same IR gives the same document
    expect(JSON.stringify(doc)).toBe(JSON.stringify(openapiDocument(await irFor("blog"))));
  });

  it("names 503 busy on every write beside its other error answers, and on no read", async () => {
    const doc = openapiDocument(await irFor("blog")) as {
      paths: Record<string, Record<string, { responses: Record<string, { $ref?: string }> }>>;
      components: { responses: Record<string, { headers?: Record<string, unknown> }> };
    };
    expect(doc.components.responses.Busy.headers).toEqual({
      "Retry-After": { description: "Seconds to wait before sending it again", schema: { type: "integer" } }
    });
    const seen = { writes: 0, reads: 0 };
    for (const [route, methods] of Object.entries(doc.paths))
      for (const [method, operation] of Object.entries(methods)) {
        const where = `${method.toUpperCase()} ${route}`;
        // An operation that lists the error answers at all lists the conflict
        if (!operation.responses["409"]) continue;
        if (method === "get") {
          expect(operation.responses["503"], where).toBeUndefined();
          seen.reads++;
        } else {
          expect(operation.responses["503"], where).toEqual({ $ref: "#/components/responses/Busy" });
          seen.writes++;
        }
      }
    // Every write of the blog: creates, updates, deletes, actions, register and sign-in, uploads
    expect(doc.paths["/api/posts"].post.responses["503"]).toBeDefined();
    expect(doc.paths["/api/posts/{id}"].patch.responses["503"]).toBeDefined();
    expect(doc.paths["/api/posts/{id}"].delete.responses["503"]).toBeDefined();
    expect(doc.paths["/api/posts/{id}/publish"].post.responses["503"]).toBeDefined();
    expect(doc.paths["/api/auth/register"].post.responses["503"]).toBeDefined();
    expect(doc.paths["/api/files/{id}/content"].put.responses["503"]).toBeDefined();
    expect(doc.paths["/api/posts"].get.responses["503"]).toBeUndefined();
    expect(doc.paths["/api/posts/{id}"].get.responses["503"]).toBeUndefined();
    expect(seen.writes).toBeGreaterThan(20);
    expect(seen.reads).toBeGreaterThan(10);
  });
});
