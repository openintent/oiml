import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";

// Set test database URL if provided (overrides DATABASE_URL)
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Ensure DATABASE_URL is set for tests
if (!process.env.DATABASE_URL) {
  console.warn(
    "⚠️  DATABASE_URL is not set. Tests will fail without a database connection.\n" +
      "   Please set DATABASE_URL in your .env file or export TEST_DATABASE_URL.\n" +
      '   Example: export DATABASE_URL="postgresql://user:password@localhost:5432/bacefook_test"'
  );
}

// Import prisma after setting DATABASE_URL
import { prisma } from "@/lib/prisma";

// Check if database tables exist (migrations have been run)
let tablesExist = false;

beforeAll(async () => {
  try {
    // Try to query a table to check if migrations have been applied
    await prisma.user.findFirst();
    tablesExist = true;
  } catch (error: any) {
    if (error?.code === "P2021" || error?.message?.includes("does not exist")) {
      console.warn(
        "\n⚠️  Database tables do not exist. Please run migrations first:\n" +
          "   npx prisma migrate deploy\n" +
          "   or\n" +
          "   npx prisma migrate dev\n" +
          "\n   Tests will fail until migrations are applied.\n"
      );
      tablesExist = false;
    } else {
      // Other errors (like connection issues) will be caught by tests
      tablesExist = false;
    }
  }
});

// Clean database before each test
beforeEach(async () => {
  if (!tablesExist) {
    return; // Skip cleanup if tables don't exist
  }

  try {
    // Delete in reverse order of dependencies to respect foreign key constraints
    // Execute sequentially to ensure proper order
    await prisma.like.deleteMany().catch(() => {});
    await prisma.comment.deleteMany().catch(() => {});
    await prisma.media.deleteMany().catch(() => {});
    await prisma.post.deleteMany().catch(() => {});
    await prisma.follow.deleteMany().catch(() => {});
    await prisma.friendship.deleteMany().catch(() => {});
    await prisma.profile.deleteMany().catch(() => {});
    await prisma.user.deleteMany().catch(() => {});

    // Verify cleanup completed by checking user count
    const userCount = await prisma.user.count().catch(() => 0);
    if (userCount > 0) {
      // Force delete all users if any remain (cascade should handle related records)
      await prisma.user.deleteMany().catch(() => {});
    }
  } catch (error) {
    // If there's a critical error, log it but don't fail the test
    // This allows tests to continue even if cleanup has issues
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Export test utilities
export { prisma };
