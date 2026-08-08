import "@testing-library/jest-dom/vitest";

// Provide env defaults so modules importing `@/lib/env` don't throw in tests.
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-32chars";
process.env.DATABASE_URL ??= "file:./test.db";
process.env.NODE_ENV ??= "test";
