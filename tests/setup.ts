import "@testing-library/jest-dom/vitest";

// Provide env defaults so modules importing `@/lib/env` don't throw in tests.
// (NODE_ENV is set to "test" by Vitest automatically and is read-only in types.)
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-32chars";
process.env.DATABASE_URL ??= "file:./test.db";
