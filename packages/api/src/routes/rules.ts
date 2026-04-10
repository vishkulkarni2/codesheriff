/**
 * Rules routes
 *
 * GET    /api/v1/rules           — list global + org rules
 * POST   /api/v1/rules           — create org custom rule
 * PATCH  /api/v1/rules/:id       — update rule (org rules only)
 * DELETE /api/v1/rules/:id       — delete org rule (global rules protected)
 * POST   /api/v1/rules/test      — test a semgrep pattern against a snippet
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codesheriff/db';
import { UserRole } from '@codesheriff/shared';
import { verifyRuleOwnership } from '../middleware/ownership.js';
import { StaticAnalyzer } from '@codesheriff/analyzer';

const createRuleSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().min(10).max(1000),
  semgrepPattern: z.string().min(10).max(10_000),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']),
  category: z.enum(['SECURITY', 'HALLUCINATION', 'AUTH', 'LOGIC', 'SECRET', 'QUALITY']),
  isAISpecific: z.boolean().default(false),
});

const updateRuleSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().min(10).max(1000).optional(),
  semgrepPattern: z.string().min(10).max(10_000).optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).optional(),
  category: z
    .enum(['SECURITY', 'HALLUCINATION', 'AUTH', 'LOGIC', 'SECRET', 'QUALITY'])
    .optional(),
  isEnabled: z.boolean().optional(),
  isAISpecific: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

const testRuleSchema = z.object({
  semgrepPattern: z.string().min(10).max(10_000),
  codeSnippet: z.string().min(1).max(5_000),
  language: z.enum(['typescript', 'javascript', 'python', 'go', 'java', 'ruby', 'php', 'rust']),
});

export async function ruleRoutes(app: FastifyInstance): Promise<void> {
  const analyzer = new StaticAnalyzer();

  // ---------------------------------------------------------------------------
  // GET /api/v1/rules
  // ---------------------------------------------------------------------------
  app.get('/rules', { preHandler: [app.authenticate] }, async (req, reply) => {
    const orgId = req.dbUser!.organizationId;

    const rules = await prisma.rule.findMany({
      where: {
        OR: [
          { organizationId: null },        // Global built-in rules
          { organizationId: orgId },        // Org-specific custom rules
        ],
      },
      orderBy: [{ organizationId: 'asc' }, { name: 'asc' }],
    });

    return reply.send({ success: true, data: rules, error: null });
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/rules — create org rule (ADMIN+ only)
  // ---------------------------------------------------------------------------
  app.post(
    '/rules',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      // Only ADMIN and OWNER can create custom rules
      if (
        req.dbUser!.role !== UserRole.ADMIN &&
        req.dbUser!.role !== UserRole.OWNER
      ) {
        return reply.status(403).send({
          success: false,
          data: null,
          error: 'Only admins can create custom rules',
        });
      }

      // Custom rules are a TEAM+ feature
      const orgForPlan = await prisma.organization.findUnique({
        where: { id: req.dbUser!.organizationId },
        select: { plan: true },
      });
      if (orgForPlan?.plan === 'FREE') {
        return reply.status(403).send({
          success: false,
          data: null,
          error: 'Custom rules require the Team plan. Upgrade at Settings > Plan & Billing.',
        });
      }

      const parsed = createRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      const rule = await prisma.rule.create({
        data: {
          ...parsed.data,
          organizationId: req.dbUser!.organizationId,
          isEnabled: true,
        },
      });

      return reply.status(201).send({ success: true, data: rule, error: null });
    }
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/rules/:id
  // ---------------------------------------------------------------------------
  app.patch(
    '/rules/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (
        req.dbUser!.role !== UserRole.ADMIN &&
        req.dbUser!.role !== UserRole.OWNER
      ) {
        return reply.status(403).send({
          success: false,
          data: null,
          error: 'Only admins can update rules',
        });
      }

      const { id } = req.params as { id: string };

      // IDOR prevention + global rule protection (allowGlobal: false = org rules only)
      const owned = await verifyRuleOwnership(req, reply, id, { allowGlobal: false });
      if (!owned) return;

      const parsed = updateRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      // Filter out undefined fields to satisfy exactOptionalPropertyTypes
      const updateData = Object.fromEntries(
        Object.entries(parsed.data).filter(([, v]) => v !== undefined)
      );
      const updated = await prisma.rule.update({
        where: { id },
        data: updateData,
      });

      return reply.send({ success: true, data: updated, error: null });
    }
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/v1/rules/:id — org rules only
  // ---------------------------------------------------------------------------
  app.delete(
    '/rules/:id',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (req.dbUser!.role !== UserRole.OWNER) {
        return reply.status(403).send({
          success: false,
          data: null,
          error: 'Only org owners can delete rules',
        });
      }

      const { id } = req.params as { id: string };
      const owned = await verifyRuleOwnership(req, reply, id, { allowGlobal: false });
      if (!owned) return;

      await prisma.rule.delete({ where: { id } });
      return reply.status(204).send();
    }
  );

  // ---------------------------------------------------------------------------
  // POST /api/v1/rules/test — test a semgrep pattern
  // ---------------------------------------------------------------------------
  app.post(
    '/rules/test',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const parsed = testRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      const { semgrepPattern, codeSnippet, language } = parsed.data;

      const scanId = `test-${Date.now()}`;
      const testFile = {
        path: `test.${languageExtension(language)}`,
        content: codeSnippet,
        language,
        lineCount: codeSnippet.split('\n').length,
        status: 'added' as const,
        patch: null,
      };

      const findings = await analyzer.detect(scanId, [testFile], semgrepPattern);

      return reply.send({
        success: true,
        data: {
          matches: findings.map((f) => ({
            line: f.lineStart,
            snippet: f.codeSnippet,
            message: f.description,
          })),
        },
        error: null,
      });
    }
  );
}

function languageExtension(lang: string): string {
  const map: Record<string, string> = {
    typescript: 'ts',
    javascript: 'js',
    python: 'py',
    go: 'go',
    java: 'java',
    ruby: 'rb',
    php: 'php',
    rust: 'rs',
  };
  return map[lang] ?? 'txt';
}
