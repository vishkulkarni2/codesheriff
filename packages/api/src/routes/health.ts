/**
 * Health check route — no authentication required.
 * Used by load balancers and container orchestrators.
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '@codesheriff/db';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_req, reply) => {
    const checks: Record<string, 'ok' | 'error'> = {};

    // Database connectivity
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'ok';
    } catch {
      checks['database'] = 'error';
    }

    // Redis connectivity — app.redis decorated in server.ts
    try {
      const redis = (app as unknown as { redis: { ping: () => Promise<string> } }).redis;
      await redis.ping();
      checks['redis'] = 'ok';
    } catch {
      checks['redis'] = 'error';
    }

    const allHealthy = Object.values(checks).every((v) => v === 'ok');

    void reply.status(allHealthy ? 200 : 503).send({
      success: allHealthy,
      data: {
        status: allHealthy ? 'healthy' : 'degraded',
        checks,
        timestamp: new Date().toISOString(),
      },
      error: allHealthy ? null : 'One or more dependencies unavailable',
    });
  });
}
