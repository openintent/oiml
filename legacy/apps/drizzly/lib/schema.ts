import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).notNull().unique(),
  name: varchar({ length: 100 }).notNull(),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow()
});

export const posts = pgTable(
  "posts",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: varchar({ length: 200 }).notNull(),
    content: text().notNull(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    author_id: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    published: boolean().notNull().default(false)
  },
  t => [index("posts_author_id_idx").on(t.author_id)]
);

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts)
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.author_id], references: [users.id] })
}));
