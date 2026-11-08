// TypeScript types for Posty

export interface ErrorResponse {
  success: false;
  error: string;
}

// User entity
export interface UserInterface {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export interface UserResponse {
  data: UserInterface | UserInterface[];
}

// Post entity
export interface PostInterface {
  id: number;
  created_at: Date;
  updated_at: Date;
  title: string;
  content: string | null;
  published: boolean;
  author_id: number;
}

export interface PostResponse {
  data: PostInterface | PostInterface[];
}

// Profile entity
export interface ProfileInterface {
  id: number;
  bio: string | null;
  user_id: number;
}

export interface ProfileResponse {
  data: ProfileInterface | ProfileInterface[];
}
