/**
 * Findings routes
 *
 * GET   /api/v1/findings          — paginated list with filters
 * PATCH /api/v1/findings/:id      — mark false positive or suppressed
 *
 * SECURITY:
 *   - All routes require authenticated user (Clerk JWT, server-side verified)
 *   - PATCH uses verifyFindingOwnership (IDOR prevention)
 *   - Filters always scoped to authenticated user's organization
 *   - Ownership check filters by organizationId from verified JWT, never request body
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codesheriff/db';
import { verifyFindingOwnership } from '../middleware/ownership.js';

const findingsQuerySchema = z.object({
  repoId: z.string().cuid().optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).optional(),
  category: z
    .enum(['SECURITY', 'HALLUCINATION', 'AUTH', 'LOGIC', 'SECRET', 'QUALITY'])
    .optional(),
  isAISpecific: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  falsePositive: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  suppressed: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const updateFindingSchema = z.object({
  falsePositive: z.boolean().optional(),
  suppressed: z.boolean().optional(),
}).refine((d) => d.falsePositive !== undefined || d.suppressed !== undefined, {
  message: 'At least one of falsePositive or suppressed must be provided',
});

export async function findingRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // GET /api/v1/findings
  // ---------------------------------------------------------------------------
  app.get(
    '/findings',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const parsed = findingsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      const {
        repoId,
        severity,
        category,
        isAISpecific,
        falsePositive,
        suppressed,
        page,
        limit,
      } = parsed.data;

      const offset = (page - 1) * limit;

      // All queries are scoped to the authenticated user's organization
      // The organizationId comes from the server-side verified JWT — never the request
      const orgId = req.dbUser!.organizationId;

      const where = {
        repository: { organizationId: orgId },
        ...(repoId ? { repositoryId: repoId } : {}),
        ...(severity ? { severity } : {}),
        ...(category ? { category } : {}),
        ...(isAISpecific !== undefined ? { isAIPatternSpecific: isAISpecific } : {}),
        ...(falsePositive !== undefined ? { falsePositive } : {}),
        ...(suppressed !== undefined ? { suppressed } : {}),
      };

      const [total, findings] = await Promise.all([
        prisma.finding.count({ where }),
        prisma.finding.findMany({
          where,
          orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
          skip: offset,
          take: limit,
          select: {
            id: true,
            title: true,
            description: true,
            severity: true,
            category: true,
            filePath: true,
            lineStart: true,
            lineEnd: true,
            codeSnippet: true,
            isAIPatternSpecific: true,
            falsePositive: true,
            suppressed: true,
            createdAt: true,
            scan: { select: { id: true, branch: true, commitSha: true } },
            repository: { select: { id: true, name: true, fullName: true } },
          },
        }),
      ]);

      return reply.send({
        success: true,
        data: findings,
        error: null,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/findings/:id
  // ---------------------------------------------------------------------------
  app.patch(
    '/findings/:id',
    {
      preHandler: [app.authenticate],
      // Tighter limit: prevent bulk-suppress attacks on security findings
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      // IDOR prevention: verify finding belongs to user's org before mutating
      const owned = await verifyFindingOwnership(req, reply, id);
      if (!owned) return;

      const parsed = updateFindingSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      const updated = await prisma.finding.update({
        where: { id },
        data: {
          ...(parsed.data.falsePositive !== undefined
            ? { falsePositive: parsed.data.falsePositive }
            : {}),
          ...(parsed.data.suppressed !== undefined
            ? { suppressed: parsed.data.suppressed }
            : {}),
        },
        select: { id: true, falsePositive: true, suppressed: true },
      });

      return reply.send({ success: true, data: updated, error: null });
    }
  );
}
