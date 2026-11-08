import type { posts, users } from "@/lib/schema";

// Rows as returned by select / returning()
export type UserInterface = typeof users.$inferSelect;
export type PostInterface = typeof posts.$inferSelect;

// Values accepted by insert
export type NewUserInterface = typeof users.$inferInsert;
export type NewPostInterface = typeof posts.$inferInsert;

export type PostWithAuthor = PostInterface & { author: UserInterface };
export type UserWithPosts = UserInterface & { posts: PostInterface[] };

export interface DataResponse<T> {
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: string;
}
