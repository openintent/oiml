import { prisma } from './setup';
import bcrypt from 'bcryptjs';

/**
 * Generate a unique identifier for test data
 */
function generateUniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a test user
 */
export async function createTestUser(overrides?: {
  email?: string;
  username?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
}) {
  const uniqueId = generateUniqueId();
  const email = overrides?.email || `test-${uniqueId}@example.com`;
  const username = overrides?.username || `testuser-${uniqueId}`;
  const password = overrides?.password || 'testpassword123';
  const password_hash = await bcrypt.hash(password, 10);

  return await prisma.user.create({
    data: {
      email,
      username,
      password_hash,
      first_name: overrides?.first_name || null,
      last_name: overrides?.last_name || null,
    },
  });
}

/**
 * Create a test post
 */
export async function createTestPost(authorId: string, overrides?: {
  content?: string;
  visibility?: 'public' | 'friends' | 'private';
}) {
  return await prisma.post.create({
    data: {
      author_id: authorId,
      content: overrides?.content || 'Test post content',
      visibility: overrides?.visibility || 'public',
    },
  });
}

/**
 * Create a test comment
 */
export async function createTestComment(userId: string, postId: string, overrides?: {
  content?: string;
  parent_comment_id?: string;
}) {
  return await prisma.comment.create({
    data: {
      user_id: userId,
      post_id: postId,
      content: overrides?.content || 'Test comment',
      parent_comment_id: overrides?.parent_comment_id || null,
    },
  });
}

/**
 * Create a test like
 */
export async function createTestLike(userId: string, postId: string) {
  return await prisma.like.create({
    data: {
      user_id: userId,
      post_id: postId,
    },
  });
}

/**
 * Create a test friendship
 */
export async function createTestFriendship(userId: string, friendId: string, overrides?: {
  status?: 'pending' | 'accepted' | 'blocked';
}) {
  return await prisma.friendship.create({
    data: {
      user_id: userId,
      friend_id: friendId,
      status: overrides?.status || 'pending',
    },
  });
}

/**
 * Create a test follow
 */
export async function createTestFollow(followerId: string, followingId: string) {
  return await prisma.follow.create({
    data: {
      follower_id: followerId,
      following_id: followingId,
    },
  });
}

/**
 * Helper to create a mock Request object
 */
export function createMockRequest(body?: any, method: string = 'GET'): Request {
  const request = new Request('http://localhost:3000/api/test', {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  // Override json method if body is provided
  if (body) {
    (request as any).json = async () => body;
  }
  
  return request;
}

/**
 * Helper to create a mock params object for Next.js route handlers
 */
export function createMockParams<T extends Record<string, string>>(params: T): Promise<T> {
  return Promise.resolve(params);
}

