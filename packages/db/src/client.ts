/**
 * Prisma client singleton.
 *
 * In development, attaches the client to the global object to survive
 * hot-module-reload cycles without exhausting connection pool limits.
 * In production, always creates a fresh client instance per process.
 */

import { PrismaClient } from '@prisma/client';

const createPrismaClient = (): PrismaClient =>
  new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

// Extend globalThis to hold our singleton in development
declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  process.env['NODE_ENV'] === 'production'
    ? createPrismaClient()
    : (globalThis.__prismaClient ??= createPrismaClient());

export { PrismaClient };
