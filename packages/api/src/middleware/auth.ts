/**
 * Clerk JWT Authentication Middleware
 *
 * Verifies Clerk JWTs SERVER-SIDE using the Clerk SDK — the token is
 * never trusted based on client-decoded payload alone.
 *
 * Routes decorated with `preHandler: [app.authenticate]` require a valid
 * Bearer token. Webhook routes use HMAC signature verification instead.
 *
 * SECURITY:
 *   - Token verification happens via Clerk SDK (RS256, server-side)
 *   - Clerk secret key is read from environment — never hardcoded
 *   - User identity is only populated after successful server-side verification
 *   - clerkUserId is attached to req for rate limiting and ownership checks
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { createClerkClient, verifyToken as clerkVerifyToken } from '@clerk/fastify';
import { prisma } from '@codesheriff/db';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /** Populated after successful JWT verification */
    clerkUserId: string | null;
    /** Database user record — only populated in authenticated routes */
    dbUser: {
      id: string;
      organizationId: string;
      role: string;
      email: string;
    } | null;
  }
}

async function authPlugin(app: FastifyInstance): Promise<void> {
  createClerkClient({
    secretKey: process.env['CLERK_SECRET_KEY']!, // Existence verified at startup
  });

  // Decorate request with null defaults so TypeScript is satisfied
  app.decorateRequest('clerkUserId', null);
  app.decorateRequest('dbUser', null);

  /**
   * authenticate — preHandler hook for protected routes.
   *
   * Verifies the Authorization: Bearer <token> header using Clerk's
   * server-side JWT verification. Attaches the verified user identity
   * to req for downstream handlers.
   *
   * Never trusts client-decoded payloads — all verification is server-side.
   */
  app.decorate(
    'authenticate',
    async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        void reply.status(401).send({
          success: false,
          data: null,
          error: 'Missing or invalid Authorization header',
        });
        return;
      }

      const token = authHeader.slice(7); // Strip "Bearer " prefix

      try {
        // SERVER-SIDE JWT verification via Clerk SDK (RS256)
        // This is the only place we trust user identity — never jwt.decode()
        const verifiedToken = await clerkVerifyToken(token, {
          secretKey: process.env['CLERK_SECRET_KEY']!,
        });

        req.clerkUserId = verifiedToken.sub;

        // Load user from database to get org membership and role
        const dbUser = await prisma.user.findUnique({
          where: { clerkId: verifiedToken.sub },
          select: {
            id: true,
            organizationId: true,
            role: true,
            email: true,
          },
        });

        if (!dbUser) {
          // User exists in Clerk but not in our DB — handle provisioning gap
          void reply.status(403).send({
            success: false,
            data: null,
            error: 'User not provisioned in CodeSheriff. Please complete onboarding.',
          });
          return;
        }

        req.dbUser = dbUser;
      } catch (err) {
        req.log.warn({ err }, 'JWT verification failed');
        void reply.status(401).send({
          success: false,
          data: null,
          error: 'Invalid or expired token',
        });
      }
    }
  );
}

// Wrap with fastify-plugin so decorators are available in all scopes
export const authMiddleware = fp(authPlugin, {
  name: 'auth',
  fastify: '4.x',
});
