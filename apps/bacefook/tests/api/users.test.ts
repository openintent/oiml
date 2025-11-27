import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/users/route";
import { GET, PUT } from "@/app/api/users/me/route";
import { GET as GET_USER_BY_ID } from "@/app/api/users/[id]/route";
import { createTestUser, createMockRequest, createMockParams } from "../helpers";
import { prisma } from "../setup";

describe("POST /api/users", () => {
  it("should create a new user successfully", async () => {
    const request = createMockRequest(
      {
        email: "newuser@example.com",
        username: "newuser",
        password: "password123",
        first_name: "John",
        last_name: "Doe"
      },
      "POST"
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.data).toHaveProperty("id");
    expect(data.data.email).toBe("newuser@example.com");
    expect(data.data.username).toBe("newuser");
    expect(data.data.first_name).toBe("John");
    expect(data.data.last_name).toBe("Doe");
    expect(data.data).not.toHaveProperty("password_hash");
  });

  it("should return 400 if required fields are missing", async () => {
    const request = createMockRequest(
      {
        email: "test@example.com"
        // missing username and password
      },
      "POST"
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Missing required fields");
  });

  it("should return 409 if email already exists", async () => {
    await createTestUser({ email: "existing@example.com", username: "user1" });

    const request = createMockRequest(
      {
        email: "existing@example.com",
        username: "user2",
        password: "password123"
      },
      "POST"
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.success).toBe(false);
    expect(data.error).toContain("already exists");
  });

  it("should return 409 if username already exists", async () => {
    await createTestUser({ email: "user1@example.com", username: "existinguser" });

    const request = createMockRequest(
      {
        email: "user2@example.com",
        username: "existinguser",
        password: "password123"
      },
      "POST"
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.success).toBe(false);
    expect(data.error).toContain("already exists");
  });

  it("should create user with optional fields as null", async () => {
    const request = createMockRequest(
      {
        email: "minimal@example.com",
        username: "minimaluser",
        password: "password123"
      },
      "POST"
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.data.first_name).toBeNull();
    expect(data.data.last_name).toBeNull();
  });
});

describe("GET /api/users/me", () => {
  it("should return 401 when authentication is not implemented", async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Authentication");
  });
});

describe("PUT /api/users/me", () => {
  it("should return 401 when authentication is not implemented", async () => {
    const request = createMockRequest(
      {
        first_name: "Updated",
        last_name: "Name"
      },
      "PUT"
    );

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Authentication");
  });
});

describe("GET /api/users/:id", () => {
  it("should return user by ID", async () => {
    const user = await createTestUser();

    const response = await GET_USER_BY_ID(createMockRequest() as Request, {
      params: createMockParams({ id: user.id })
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.id).toBe(user.id);
    expect(data.data.email).toBe(user.email);
    expect(data.data.username).toBe(user.username);
  });

  it("should return 404 if user not found", async () => {
    const response = await GET_USER_BY_ID(createMockRequest() as Request, {
      params: createMockParams({ id: "00000000-0000-0000-0000-000000000000" })
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error).toBe("User not found");
  });
});
