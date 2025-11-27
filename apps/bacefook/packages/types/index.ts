// TypeScript types for Bacefook entities
// These types match the Prisma schema and use | null for nullable fields (not optional ?)

export type PostVisibility = "public" | "friends" | "private";
export type MediaType = "image" | "video" | "gif";
export type FriendshipStatus = "pending" | "accepted" | "blocked";

export interface UserInterface {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean;
  is_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ProfileInterface {
  id: string;
  user_id: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  birth_date: Date | null;
  profile_picture_url: string | null;
  cover_photo_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PostInterface {
  id: string;
  author_id: string;
  content: string;
  visibility: PostVisibility;
  created_at: Date;
  updated_at: Date;
}

export interface LikeInterface {
  id: string;
  user_id: string;
  post_id: string;
  created_at: Date;
}

export interface CommentInterface {
  id: string;
  user_id: string;
  post_id: string;
  parent_comment_id: string | null;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export interface MediaInterface {
  id: string;
  post_id: string;
  url: string;
  type: MediaType;
  width: number | null;
  height: number | null;
  file_size: number | null;
  created_at: Date;
}

export interface FriendshipInterface {
  id: string;
  user_id: string;
  friend_id: string;
  status: FriendshipStatus;
  created_at: Date;
  updated_at: Date;
}

export interface FollowInterface {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: Date;
}

// Response types (following api.response format from project.yaml - defaults to { data: ... })
export interface UserResponse {
  data: UserInterface | UserInterface[];
}

export interface ProfileResponse {
  data: ProfileInterface | ProfileInterface[];
}

export interface PostResponse {
  data: PostInterface | PostInterface[];
}

export interface LikeResponse {
  data: LikeInterface | LikeInterface[];
}

export interface CommentResponse {
  data: CommentInterface | CommentInterface[];
}

export interface MediaResponse {
  data: MediaInterface | MediaInterface[];
}

export interface FriendshipResponse {
  data: FriendshipInterface | FriendshipInterface[];
}

export interface FollowResponse {
  data: FollowInterface | FollowInterface[];
}

export interface ErrorResponse {
  success: false;
  error: string;
}
