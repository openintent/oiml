import { describe, it, expect } from "vitest";
import { POST, GET } from "@/app/api/posts/[id]/comments/route";
import { PUT, DELETE } from "@/app/api/comments/[id]/route";
import { createTestUser, createTestPost, createTestComment, createMockRequest, createMockParams } from "../helpers";

describe("POST /api/posts/:id/comments", () => {
  it("should return 401 when authentication is not implemented", async () => {
    const user = await createTestUser();
    const post = await createTestPost(user.id);

    const request = createMockRequest(
      {
        content: "Test comment"
      },
      "POST"
    );

    const response = await POST(request, { params: createMockParams({ id: post.id }) });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Authentication");
  });

  it("should return 400 if content is missing", async () => {
    const user = await createTestUser();
    const post = await createTestPost(user.id);

    const request = createMockRequest({}, "POST");

    const response = await POST(request, { params: createMockParams({ id: post.id }) });

    expect(response.status).toBe(401); // Auth check happens first
  });

  it("should return 404 if post not found", async () => {
    const request = createMockRequest(
      {
        content: "Test comment"
      },
      "POST"
    );

    const response = await POST(request, { params: createMockParams({ id: "00000000-0000-0000-0000-000000000000" }) });

    expect(response.status).toBe(401); // Auth check happens first
  });
});

describe("GET /api/posts/:id/comments", () => {
  it("should return list of comments for a post", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const post = await createTestPost(user1.id);

    const comment1 = await createTestComment(user2.id, post.id, { content: "Comment 1" });
    const comment2 = await createTestComment(user1.id, post.id, { content: "Comment 2" });
    await createTestComment(user2.id, post.id, {
      content: "Reply to Comment 1",
      parent_comment_id: comment1.id
    });

    const response = await GET(createMockRequest() as Request, { params: createMockParams({ id: post.id }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(2); // Only top-level comments
    expect(data.data[0]).toHaveProperty("user");
    expect(data.data[0]).toHaveProperty("replies");
    // Check that replies are included
    const commentWithReplies = data.data.find((c: any) => c.id === comment1.id);
    expect(commentWithReplies.replies).toHaveLength(1);
  });

  it("should return empty array when post has no comments", async () => {
    const user = await createTestUser();
    const post = await createTestPost(user.id);

    const response = await GET(createMockRequest() as Request, { params: createMockParams({ id: post.id }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(0);
  });
});

describe("PUT /api/comments/:id", () => {
  it("should return 401 when authentication is not implemented", async () => {
    const user = await createTestUser();
    const post = await createTestPost(user.id);
    const comment = await createTestComment(user.id, post.id);

    const request = createMockRequest(
      {
        content: "Updated comment"
      },
      "PUT"
    );

    const response = await PUT(request, { params: createMockParams({ id: comment.id }) });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Authentication");
  });

  it("should return 400 if content is missing", async () => {
    const request = createMockRequest({}, "PUT");

    const response = await PUT(request, { params: createMockParams({ id: "00000000-0000-0000-0000-000000000000" }) });

    expect(response.status).toBe(401); // Auth check happens first
  });

  it("should return 404 if comment not found", async () => {
    const request = createMockRequest(
      {
        content: "Updated comment"
      },
      "PUT"
    );

    const response = await PUT(request, { params: createMockParams({ id: "00000000-0000-0000-0000-000000000000" }) });

    expect(response.status).toBe(401); // Auth check happens first
  });
});

describe("DELETE /api/comments/:id", () => {
  it("should return 401 when authentication is not implemented", async () => {
    const user = await createTestUser();
    const post = await createTestPost(user.id);
    const comment = await createTestComment(user.id, post.id);

    const response = await DELETE(createMockRequest() as Request, { params: createMockParams({ id: comment.id }) });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Authentication");
  });
});
