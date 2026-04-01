/**
 * Fastify server factory.
 * Separated from index.ts so it can be imported in tests without starting
 * a real network listener.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyFormbody from '@fastify/formbody';
import type { Redis } from 'ioredis';
import { logger } from './plugins/logger.js';

// Route handlers
import { healthRoutes } from './routes/health.js';
import { scanRoutes } from './routes/scans.js';
import { repoRoutes } from './routes/repos.js';
import { findingRoutes } from './routes/findings.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { ruleRoutes } from './routes/rules.js';
import { orgRoutes } from './routes/orgs.js';

// Webhook handlers
import { githubWebhookRoutes } from './webhooks/github.js';
import { gitlabWebhookRoutes } from './webhooks/gitlab.js';

// Auth middleware
import { authMiddleware } from './middleware/auth.js';

export interface ServerOptions {
  redis: Redis;
}

/**
 * Build and configure the Fastify application instance.
 * Does NOT start listening — call app.listen() separately.
 */
export async function buildServer(opts: ServerOptions) {
  const app = Fastify({
    // Pass the pre-configured pino instance directly
    loggerInstance: logger,
    trustProxy: true, // Required when behind Render/Railway/Vercel proxy
    requestIdHeader: 'x-request-id',
  });

  // -------------------------------------------------------------------------
  // Security plugins
  // -------------------------------------------------------------------------

  // Helmet sets security headers (CSP, HSTS, X-Frame-Options, etc.)
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  });

  // CORS: explicitly enumerate allowed origins — NEVER use wildcard in production
  const allowedOrigins = buildAllowedOrigins();
  await app.register(fastifyCors, {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., curl, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`), false);
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    credentials: true,
    maxAge: 86400, // 24h preflight cache
  });

  // Global rate limiting — stricter limits applied per-route on sensitive endpoints
  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    redis: opts.redis,
    keyGenerator: (req) => {
      // Rate limit by Clerk user ID when authenticated, otherwise by IP
      const clerkUserId = (req as { clerkUserId?: string }).clerkUserId;
      return clerkUserId ?? req.ip;
    },
    errorResponseBuilder: (_req, context) => ({
      success: false,
      data: null,
      error: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)}s.`,
    }),
  });

  await app.register(fastifyFormbody);

  // -------------------------------------------------------------------------
  // Decorators — attach shared resources to every request
  // -------------------------------------------------------------------------
  app.decorate('redis', opts.redis);

  // -------------------------------------------------------------------------
  // Authentication middleware (Clerk JWT verification — server-side only)
  // -------------------------------------------------------------------------
  await app.register(authMiddleware);

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  // Public health check (no auth required)
  await app.register(healthRoutes);

  // Webhook receivers (use HMAC sig auth, not Clerk)
  await app.register(githubWebhookRoutes, { prefix: '/webhooks' });
  await app.register(gitlabWebhookRoutes, { prefix: '/webhooks' });

  // Authenticated API routes
  await app.register(scanRoutes, { prefix: '/api/v1' });
  await app.register(repoRoutes, { prefix: '/api/v1' });
  await app.register(findingRoutes, { prefix: '/api/v1' });
  await app.register(dashboardRoutes, { prefix: '/api/v1' });
  await app.register(ruleRoutes, { prefix: '/api/v1' });
  await app.register(orgRoutes, { prefix: '/api/v1' });

  // -------------------------------------------------------------------------
  // Global error handler — structured, never leaks stack traces in prod
  // -------------------------------------------------------------------------
  app.setErrorHandler((error, req, reply) => {
    const statusCode = error.statusCode ?? 500;
    const requestId = req.id;

    if (statusCode >= 500) {
      // Log full error detail server-side for 5xx
      req.log.error({ err: error, requestId }, 'internal server error');
    } else {
      req.log.warn({ err: error, statusCode, requestId }, 'request error');
    }

    const message =
      process.env['NODE_ENV'] === 'production' && statusCode >= 500
        ? 'Internal server error'
        : (error.message ?? 'Unknown error');

    void reply.status(statusCode).send({
      success: false,
      data: null,
      error: message,
    });
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({
      success: false,
      data: null,
      error: `Route ${req.method} ${req.url} not found`,
    });
  });

  return app;
}

/**
 * Build the set of allowed CORS origins from environment config.
 * Falls back to localhost in development. Never includes wildcard.
 */
function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();

  const frontendUrl = process.env['FRONTEND_URL'];
  if (frontendUrl) origins.add(frontendUrl);

  if (process.env['NODE_ENV'] !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }

  // Optional: additional origins from env (comma-separated)
  const extra = process.env['ADDITIONAL_CORS_ORIGINS'];
  if (extra) {
    for (const o of extra.split(',')) {
      const trimmed = o.trim();
      if (trimmed) origins.add(trimmed);
    }
  }

  return origins;
}
