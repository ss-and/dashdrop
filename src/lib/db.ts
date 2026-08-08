import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * Cast an arbitrary JS value to Prisma's Json input type. Prisma's generated
 * Json types are intentionally strict; our field data / options / activity meta
 * are validated by Zod before reaching the DB, so this narrowing is safe.
 */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * Prisma client singleton. Next.js hot-reloads modules in dev which would
 * otherwise exhaust the connection pool, so we cache the instance on globalThis.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
