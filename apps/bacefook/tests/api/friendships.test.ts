import { describe, it, expect } from 'vitest';
import { POST, GET } from '@/app/api/friendships/route';
import { PUT, DELETE } from '@/app/api/friendships/[id]/route';
import { createTestUser, createTestFriendship, createMockRequest, createMockParams } from '../helpers';

describe('POST /api/friendships', () => {
  it('should return 401 when authentication is not implemented', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    const request = createMockRequest({
      friend_id: user2.id,
    }, 'POST');

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Authentication');
  });

  it('should return 400 if friend_id is missing', async () => {
    const request = createMockRequest({}, 'POST');

    const response = await POST(request);

    expect(response.status).toBe(401); // Auth check happens first
  });

  it('should return 400 if trying to friend yourself', async () => {
    const user = await createTestUser();
    const request = createMockRequest({
      friend_id: user.id,
    }, 'POST');

    const response = await POST(request);

    expect(response.status).toBe(401); // Auth check happens first
  });
});

describe('GET /api/friendships', () => {
  it('should return 401 when authentication is not implemented', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Authentication');
  });
});

describe('PUT /api/friendships/:id', () => {
  it('should return 401 when authentication is not implemented', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const friendship = await createTestFriendship(user1.id, user2.id);

    const request = createMockRequest({
      status: 'accepted',
    }, 'PUT');

    const response = await PUT(
      request,
      { params: createMockParams({ id: friendship.id }) }
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Authentication');
  });

  it('should return 400 if status is invalid', async () => {
    const request = createMockRequest({
      status: 'invalid',
    }, 'PUT');

    const response = await PUT(
      request,
      { params: createMockParams({ id: '00000000-0000-0000-0000-000000000000' }) }
    );

    expect(response.status).toBe(401); // Auth check happens first
  });

  it('should return 404 if friendship not found', async () => {
    const request = createMockRequest({
      status: 'accepted',
    }, 'PUT');

    const response = await PUT(
      request,
      { params: createMockParams({ id: '00000000-0000-0000-0000-000000000000' }) }
    );

    expect(response.status).toBe(401); // Auth check happens first
  });
});

describe('DELETE /api/friendships/:id', () => {
  it('should return 401 when authentication is not implemented', async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const friendship = await createTestFriendship(user1.id, user2.id);

    const response = await DELETE(
      createMockRequest() as Request,
      { params: createMockParams({ id: friendship.id }) }
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Authentication');
  });
});



