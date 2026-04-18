/**
 * Admin stats route
 *
 * GET /api/v1/admin/stats — platform-wide metrics for internal monitoring.
 *
 * Protected by ADMIN_API_KEY header (not Clerk auth) so COO bot and
 * monitoring tools can call it without a user session.
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '@codesheriff/db';

const ADMIN_API_KEY = process.env['ADMIN_API_KEY'] ?? '';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/admin/stats',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const apiKey = req.headers['x-admin-key'] ?? req.headers['authorization']?.replace('Bearer ', '');

      if (!ADMIN_API_KEY || apiKey !== ADMIN_API_KEY) {
        return reply.status(401).send({
          success: false,
          data: null,
          error: 'Invalid or missing admin API key',
        });
      }

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        totalOrgs,
        totalUsers,
        totalRepos,
        totalScans,
        scansLast7d,
        scansLast30d,
        completedScans,
        failedScans,
        totalFindings,
        findingsBySeverity,
        orgsByPlan,
        recentScans,
      ] = await Promise.all([
        prisma.organization.count(),
        prisma.user.count(),
        prisma.repository.count(),
        prisma.scan.count(),
        prisma.scan.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        prisma.scan.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
        prisma.scan.count({ where: { status: 'COMPLETE' } }),
        prisma.scan.count({ where: { status: 'FAILED' } }),
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
            totalFindings,
          },
          activity: {
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
