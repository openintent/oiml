# API Tests

This directory contains comprehensive API tests for all endpoints in the Bacefook application.

## Setup

1. Install dependencies:
```bash
npm install
```

2. **Required**: Set up database connection. Tests require a DATABASE_URL environment variable:
```bash
# Option 1: Use existing DATABASE_URL from .env
# Make sure .env file has DATABASE_URL set
# Example: DATABASE_URL="postgresql://user:password@localhost:5432/bacefook"

# Option 2: Use a separate test database (recommended)
export TEST_DATABASE_URL="postgresql://user:password@localhost:5432/bacefook_test"
# Or add to .env file:
# TEST_DATABASE_URL=postgresql://user:password@localhost:5432/bacefook_test

# Option 3: Export directly before running tests
export DATABASE_URL="postgresql://user:password@localhost:5432/bacefook_test"
```

3. **Required**: Run database migrations before running tests:
```bash
# Make sure migrations are applied to your test database
npx prisma migrate deploy
# Or if using a fresh database:
npx prisma migrate dev
```

4. Run tests:
```bash
npm test              # Run tests once
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

**Important Notes**:
- Tests use a **real database connection** and will **clean the database before each test**
- Make sure you're using a **test database** or are comfortable with data being deleted
- All tables (likes, comments, media, posts, follows, friendships, profiles, users) are cleared before each test
- Tests will fail with a clear error message if DATABASE_URL is not set
- **Migrations must be applied** before running tests - the test setup will warn you if tables don't exist
- If you see "table does not exist" errors, run `npx prisma migrate deploy` or `npx prisma migrate dev`

## Test Structure

- `setup.ts` - Test setup and database cleanup
- `helpers.ts` - Test utility functions for creating test data
- `api/` - Test files organized by endpoint group:
  - `users.test.ts` - User endpoints
  - `posts.test.ts` - Post endpoints
  - `likes.test.ts` - Like endpoints
  - `comments.test.ts` - Comment endpoints
  - `friendships.test.ts` - Friendship endpoints
  - `follows.test.ts` - Follow endpoints

## Test Coverage

Each endpoint is tested for:
- ✅ Success cases
- ✅ Validation errors (400)
- ✅ Authentication errors (401)
- ✅ Authorization errors (403)
- ✅ Not found errors (404)
- ✅ Conflict errors (409)
- ✅ Edge cases

## Notes

- Tests use a real database connection (configured via DATABASE_URL or TEST_DATABASE_URL)
- Database is cleaned before each test
- Authentication endpoints return 401 since auth middleware is not yet implemented
- Tests verify response structure matches the API response format: `{ data: ... }` for success, `{ success: false, error: "..." }` for errors

