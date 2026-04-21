/**
 * Admin stats route
 *
 * GET /api/v1/admin/stats — platform-wide metrics for internal monitoring.
 *
 * Protected by ADMIN_API_KEY header (not Clerk auth) so COO bot and
 * monitoring tools can call it without a user session.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { prisma } from '@codesheriff/db';

const ADMIN_API_KEY = process.env['ADMIN_API_KEY'] ?? '';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Shared admin auth check
  const requireAdmin = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const apiKey = req.headers['x-admin-key'] ?? req.headers['authorization']?.replace('Bearer ', '');
    if (!ADMIN_API_KEY || apiKey !== ADMIN_API_KEY) {
      void reply.status(401).send({
        success: false,
        data: null,
        error: 'Invalid or missing admin API key',
      });
      return false;
    }
    return true;
  };

  /**
   * GET /api/v1/admin/scans?status=FAILED&limit=50
   * List scans filtered by status for incident triage.
   * Read-only; admin-key gated; rate-limited.
   */
  app.get(
    '/admin/scans',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;

      const query = req.query as { status?: string; limit?: string };
      const status = (query.status ?? 'FAILED').toUpperCase();
      const allowed = ['QUEUED', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED'];
      if (!allowed.includes(status)) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: `Invalid status. Must be one of ${allowed.join(', ')}`,
        });
      }

      const limit = Math.min(parseInt(query.limit ?? '50', 10) || 50, 200);

      const scans = await prisma.scan.findMany({
        where: { status: status as 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED' | 'CANCELLED' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          status: true,
          triggeredBy: true,
          prNumber: true,
          branch: true,
          commitSha: true,
          durationMs: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          riskScore: true,
          findingsCount: true,
          repository: {
            select: { fullName: true, provider: true },
          },
        },
      });

      return reply.send({
        success: true,
        data: {
          count: scans.length,
          scans: scans.map((s) => ({
            id: s.id,
            status: s.status,
            repo: s.repository?.fullName ?? 'unknown',
            provider: s.repository?.provider ?? null,
            triggeredBy: s.triggeredBy,
            prNumber: s.prNumber,
            branch: s.branch,
            commitSha: s.commitSha,
            durationMs: s.durationMs,
            startedAt: s.startedAt,
            completedAt: s.completedAt,
            createdAt: s.createdAt,
            riskScore: s.riskScore,
            findingsCount: s.findingsCount,
          })),
        },
        error: null,
      });
    },
  );

  /**
   * GET /api/v1/admin/scans/:scanId/error
   * Returns failure diagnostics for a scan. DB columns are primary (persistent,
   * no TTL); falls back to Redis stash for records written before this schema
   * change (commit 911d5dd legacy records, 7-day TTL).
   */
  app.get<{ Params: { scanId: string } }>(
    '/admin/scans/:scanId/error',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;

      const { scanId } = req.params;
      if (!scanId || !/^[a-z0-9]{20,40}$/i.test(scanId)) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: 'Invalid scanId',
        });
      }

      // DB-first: read persistent error columns added in this migration
      const scan = await prisma.scan.findUnique({
        where: { id: scanId },
        select: {
          id: true,
          status: true,
          errorMessage: true,
          errorType: true,
          errorStack: true,
          durationMs: true,
          completedAt: true,
        },
      });

      if (!scan) {
        return reply.status(404).send({
          success: false,
          data: null,
          error: 'Scan not found',
        });
      }

      if (scan.errorMessage !== null) {
        return reply.send({
          success: true,
          data: {
            scanId: scan.id,
            source: 'db',
            errorType: scan.errorType,
            errorMessage: scan.errorMessage,
            errorStack: scan.errorStack,
            durationMs: scan.durationMs,
            failedAt: scan.completedAt?.toISOString() ?? null,
          },
          error: null,
        });
      }

      // Fallback: Redis stash for legacy records pre-migration
      const redis = (app as FastifyInstance & { redis?: Redis }).redis;
      if (redis) {
        const raw = await redis.get(`scan_error:${scanId}`);
        if (raw) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            return reply.status(500).send({
              success: false,
              data: null,
              error: 'Stashed diagnostic is not valid JSON',
            });
          }
          return reply.send({ success: true, data: { ...(parsed as object), source: 'redis' }, error: null });
        }
      }

      return reply.status(404).send({
        success: false,
        data: null,
        error: 'No error diagnostic for this scan (not a failed scan, or pre-instrumentation)',
      });
    },
  );

  /**
   * DELETE /api/v1/admin/scans/:scanId
   * Hard-delete a single scan and its cascade children (Findings).
   * Admin-key gated. Intended for operational cleanup of known-bad
   * historical records that poison aggregate metrics (e.g. failed
   * dogfood scans from before the pipeline stabilized).
   *
   * Not a bulk endpoint — blast radius intentionally small.
   */
  app.delete<{ Params: { scanId: string } }>(
    '/admin/scans/:scanId',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;

      const { scanId } = req.params;
      if (!scanId || !/^[a-z0-9]{20,40}$/i.test(scanId)) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: 'Invalid scanId',
        });
      }

      const existing = await prisma.scan.findUnique({
        where: { id: scanId },
        select: { id: true, status: true, findingsCount: true },
      });
      if (!existing) {
        return reply.status(404).send({
          success: false,
          data: null,
          error: 'Scan not found',
        });
      }

      // Transactional delete: children first (explicit for audit clarity),
      // then scan. Finding.scanId has onDelete: Cascade in the schema, so
      // the explicit deleteMany is defensive — it returns a count we log.
      const result = await prisma.$transaction(async (tx) => {
        const findings = await tx.finding.deleteMany({ where: { scanId } });
        await tx.scan.delete({ where: { id: scanId } });
        return { findingsDeleted: findings.count };
      });

      req.log.warn(
        { scanId, status: existing.status, findingsDeleted: result.findingsDeleted },
        'admin scan delete',
      );

      return reply.send({
        success: true,
        data: {
          deleted: {
            scanId,
            previousStatus: existing.status,
            relatedRowsDeleted: {
              findings: result.findingsDeleted,
            },
          },
        },
        error: null,
      });
    },
  );

  app.get(
    '/admin/stats',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        totalOrgs,
        totalUsers,
        totalRepos,
        totalScans,
        scansLast24h,
        scansLast7d,
        scansLast30d,
        completedScans,
        failedScans,
        failedScansLast24h,
        failedScansLast7d,
        totalFindings,
        findingsBySeverity,
        orgsByPlan,
        recentScans,
      ] = await Promise.all([
        prisma.organization.count(),
        prisma.user.count(),
        prisma.repository.count(),
        prisma.scan.count(),
        prisma.scan.count({ where: { createdAt: { gte: oneDayAgo } } }),
        prisma.scan.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        prisma.scan.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
        prisma.scan.count({ where: { status: 'COMPLETE' } }),
        prisma.scan.count({ where: { status: 'FAILED' } }),
        prisma.scan.count({ where: { status: 'FAILED', createdAt: { gte: oneDayAgo } } }),
        prisma.scan.count({ where: { status: 'FAILED', createdAt: { gte: sevenDaysAgo } } }),
        prisma.finding.count(),
        prisma.finding.groupBy({
          by: ['severity'],
          _count: { severity: true },
        }),
        prisma.organization.groupBy({
          by: ['plan'],
          _count: { plan: true },
        }),
        prisma.scan.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            riskScore: true,
            findingsCount: true,
            criticalCount: true,
            highCount: true,
            durationMs: true,
            createdAt: true,
            repository: {
              select: { fullName: true },
            },
          },
        }),
      ]);

      const severityMap: Record<string, number> = {};
      for (const s of findingsBySeverity) {
        severityMap[s.severity] = s._count.severity;
      }

      const planMap: Record<string, number> = {};
      for (const p of orgsByPlan) {
        planMap[p.plan] = p._count.plan;
      }

      return reply.send({
        success: true,
        data: {
          overview: {
            totalOrgs,
            totalUsers,
            totalRepos,
            totalScans,
            completedScans,
            failedScans,
            failedScansLast24h,
            failedScansLast7d,
            totalFindings,
          },
          activity: {
            scansLast24h,
            scansLast7d,
            scansLast30d,
          },
          findingsBySeverity: severityMap,
          orgsByPlan: planMap,
          recentScans: recentScans.map((s) => ({
            id: s.id,
            repo: s.repository?.fullName ?? 'unknown',
            status: s.status,
            riskScore: s.riskScore,
            findings: s.findingsCount,
            critical: s.criticalCount,
            high: s.highCount,
            durationMs: s.durationMs,
            createdAt: s.createdAt,
          })),
          generatedAt: now.toISOString(),
        },
        error: null,
      });
    },
  );
}
