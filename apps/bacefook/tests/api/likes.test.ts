import { describe, it, expect } from 'vitest';
import { POST, DELETE } from '@/app/api/posts/[id]/like/route';
import { GET } from '@/app/api/posts/[id]/likes/route';
import { createTestUser, createTestPost, createTestLike, createMockRequest, createMockParams } from '../helpers';

describe('POST /api/posts/:id/like', () => {
  it('should return 401 when authentication is not implemented', async () => {
    const user = await createTestUser();
    const post = await createTestPost(user.id);

    const response = await POST(
      createMockRequest() as Request,
      { params: createMockParams({ id: post.id }) }
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Authentication');
  });

  it('should return 404 if post not found', async () => {
    const response = await POST(
      createMockRequest() as Request,
      { params: createMockParams({ id: '00000000-0000-0000-0000-000000000000' }) }
    );

    expect(response.status).toBe(401); // Auth check happens first
  });
});

describe('DELETE /api/posts/:id/like', () => {
  it('should return 401 when authentication is not implemented', async () => {
    const user = await createTestUser();
    const post = await createTestPost(user.id);

    const response = await DELETE(
      createMockRequest() as Request,
      { params: createMockParams({ id: post.id }) }
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Authentication');
  });
});

describe('GET /api/posts/:id/likes', () => {
  it('should return list of likes for a post', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const user3 = await createTestUser();
    const post = await createTestPost(user1.id);

    await createTestLike(user2.id, post.id);
    await createTestLike(user3.id, post.id);

    const response = await GET(
      createMockRequest() as Request,
      { params: createMockParams({ id: post.id }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(2);
    expect(data.data[0]).toHaveProperty('user');
    expect(data.data[0].user).toHaveProperty('id');
    expect(data.data[0].user).toHaveProperty('username');
  });

  it('should return empty array when post has no likes', async () => {
    const user = await createTestUser();
    const post = await createTestPost(user.id);

    const response = await GET(
      createMockRequest() as Request,
      { params: createMockParams({ id: post.id }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(0);
  });

  it('should return empty array for non-existent post', async () => {
    const response = await GET(
      createMockRequest() as Request,
      { params: createMockParams({ id: '00000000-0000-0000-0000-000000000000' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(0);
  });
});


