/**
 * CodeSheriff API Server — Entry Point
 *
 * Fastify application with:
 *   - Helmet for security headers
 *   - CORS restricted to allowlisted origins (never wildcard in production)
 *   - Rate limiting on all routes (tighter on auth/webhook endpoints)
 *   - Clerk JWT authentication middleware
 *   - Structured pino logging with request ID correlation
 *   - Graceful shutdown on SIGTERM/SIGINT
 */

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyFormbody from '@fastify/formbody';
import { Redis } from 'ioredis';
import { logger } from './plugins/logger.js';
import { buildServer } from './server.js';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function main(): Promise<void> {
  // Fail fast if critical env vars are missing — never start with empty secrets
  assertRequiredEnv([
    'DATABASE_URL',
    'REDIS_URL',
    'CLERK_SECRET_KEY',
    'ANTHROPIC_API_KEY',
  ]);

  const redis = new Redis(process.env['REDIS_URL']!, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    enableReadyCheck: true,
  });

  redis.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
  });

  const app = await buildServer({ redis });

  // Graceful shutdown — drain in-flight requests before closing
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown signal received');
    await app.close();
    await redis.quit();
    logger.info('server shut down cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info({ port: PORT, host: HOST }, 'CodeSheriff API listening');
  } catch (err) {
    logger.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

/**
 * Assert that required environment variables are set.
 * Logs each missing variable name (never values) and exits.
 */
function assertRequiredEnv(keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    // Log variable names only — never log values
    logger.error({ missing }, 'required environment variables not set');
    process.exit(1);
  }
}

void main();
