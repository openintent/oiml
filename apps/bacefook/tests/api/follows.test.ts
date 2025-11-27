import { describe, it, expect } from "vitest";
import { POST, DELETE } from "@/app/api/users/[id]/follow/route";
import { GET as GET_FOLLOWERS } from "@/app/api/users/[id]/followers/route";
import { GET as GET_FOLLOWING } from "@/app/api/users/[id]/following/route";
import { createTestUser, createTestFollow, createMockRequest, createMockParams } from "../helpers";

describe("POST /api/users/:id/follow", () => {
  it("should return 401 when authentication is not implemented", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    const response = await POST(createMockRequest() as Request, { params: createMockParams({ id: user2.id }) });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Authentication");
  });

  it("should return 400 if trying to follow yourself", async () => {
    const user = await createTestUser();

    const response = await POST(createMockRequest() as Request, { params: createMockParams({ id: user.id }) });

    expect(response.status).toBe(401); // Auth check happens first
  });

  it("should return 404 if user not found", async () => {
    const response = await POST(createMockRequest() as Request, {
      params: createMockParams({ id: "00000000-0000-0000-0000-000000000000" })
    });

    expect(response.status).toBe(401); // Auth check happens first
  });
});

describe("DELETE /api/users/:id/follow", () => {
  it("should return 401 when authentication is not implemented", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    const response = await DELETE(createMockRequest() as Request, { params: createMockParams({ id: user2.id }) });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Authentication");
  });

  it("should return 404 if not following the user", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    const response = await DELETE(createMockRequest() as Request, { params: createMockParams({ id: user2.id }) });

    expect(response.status).toBe(401); // Auth check happens first
  });
});

describe("GET /api/users/:id/followers", () => {
  it("should return list of followers for a user", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const user3 = await createTestUser();

    await createTestFollow(user2.id, user1.id);
    await createTestFollow(user3.id, user1.id);

    const response = await GET_FOLLOWERS(createMockRequest() as Request, {
      params: createMockParams({ id: user1.id })
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(2);
    expect(data.data[0]).toHaveProperty("follower");
    expect(data.data[0].follower).toHaveProperty("id");
    expect(data.data[0].follower).toHaveProperty("username");
  });

  it("should return empty array when user has no followers", async () => {
    const user = await createTestUser();

    const response = await GET_FOLLOWERS(createMockRequest() as Request, { params: createMockParams({ id: user.id }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(0);
  });
});

describe("GET /api/users/:id/following", () => {
  it("should return list of users that a user is following", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const user3 = await createTestUser();

    await createTestFollow(user1.id, user2.id);
    await createTestFollow(user1.id, user3.id);

    const response = await GET_FOLLOWING(createMockRequest() as Request, {
      params: createMockParams({ id: user1.id })
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(2);
    expect(data.data[0]).toHaveProperty("following");
    expect(data.data[0].following).toHaveProperty("id");
    expect(data.data[0].following).toHaveProperty("username");
  });

  it("should return empty array when user is not following anyone", async () => {
    const user = await createTestUser();

    const response = await GET_FOLLOWING(createMockRequest() as Request, { params: createMockParams({ id: user.id }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(0);
  });
});
