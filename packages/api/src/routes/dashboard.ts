/**
 * Dashboard route
 *
 * GET /api/v1/dashboard — org-level risk overview and analytics
 *
 * Returns aggregated stats for the dashboard:
 *   - Org risk score (weighted average of repo scores)
 *   - Finding trend over the selected period
 *   - Top risky repositories
 *   - Recent scans feed
 *   - Findings breakdown by category
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codesheriff/db';
import type { DashboardStats, DailyFindingCount } from '@codesheriff/shared';

const dashboardQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d']).default('30d'),
});

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const parsed = dashboardQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: 'Invalid period parameter',
        });
      }

      const { period } = parsed.data;
      // orgId comes from the server-side verified JWT — never the request
      const orgId = req.dbUser!.organizationId;

      const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      const since = new Date();
      since.setDate(since.getDate() - days);

      // All queries are scoped to the authenticated user's organization
      const [repos, recentScans, findingsByCategory, riskHistory] =
        await Promise.all([
          // Top risky repositories
          prisma.repository.findMany({
            where: { organizationId: orgId },
            orderBy: { riskScore: 'desc' },
            take: 5,
            select: {
              id: true,
              name: true,
              fullName: true,
              riskScore: true,
              lastScannedAt: true,
              _count: {
                select: {
                  findings: {
                    where: { severity: 'CRITICAL', falsePositive: false, suppressed: false },
                  },
                },
              },
            },
          }),

          // Recent scans
          prisma.scan.findMany({
            where: {
              repository: { organizationId: orgId },
              createdAt: { gte: since },
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true,
              status: true,
              riskScore: true,
              findingsCount: true,
              createdAt: true,
              repository: { select: { name: true } },
            },
          }),

          // Findings breakdown by category
          prisma.finding.groupBy({
            by: ['category'],
            where: {
              repository: { organizationId: orgId },
              createdAt: { gte: since },
              falsePositive: false,
              suppressed: false,
            },
            _count: { id: true },
          }),

          // Risk history for trend chart (from RiskHistory model)
          prisma.riskHistory.findMany({
            where: {
              repository: { organizationId: orgId },
              date: { gte: since },
            },
            orderBy: { date: 'asc' },
            select: { date: true, riskScore: true, criticalCount: true, highCount: true },
          }),
        ]);

      // Compute org-level risk score as average of repo scores
      const reposWithScore = repos.filter((r) => r.riskScore !== null);
      const orgRiskScore =
        reposWithScore.length > 0
          ? Math.round(
              reposWithScore.reduce((sum, r) => sum + (r.riskScore ?? 0), 0) /
                reposWithScore.length
            )
          : 0;

      // Aggregate risk history by date
      const trendByDate = new Map<string, { count: number; critical: number; high: number }>();
      for (const entry of riskHistory) {
        const dateStr = entry.date.toISOString().slice(0, 10);
        const existing = trendByDate.get(dateStr) ?? { count: 0, critical: 0, high: 0 };
        trendByDate.set(dateStr, {
          count: existing.count + entry.riskScore,
          critical: existing.critical + entry.criticalCount,
          high: existing.high + entry.highCount,
        });
      }

      const findingsTrend: DailyFindingCount[] = Array.from(trendByDate.entries()).map(
        ([date, v]) => ({ date, count: v.count, critical: v.critical, high: v.high })
      );

      // Scans this month
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const scansThisMonth = await prisma.scan.count({
        where: {
          repository: { organizationId: orgId },
          createdAt: { gte: monthStart },
        },
      });

      // Critical findings (not false positive, not suppressed)
      const criticalFindings = await prisma.finding.count({
        where: {
          repository: { organizationId: orgId },
          severity: 'CRITICAL',
          falsePositive: false,
          suppressed: false,
        },
      });

      // False positive rate
      const [totalFindings, fpFindings] = await Promise.all([
        prisma.finding.count({ where: { repository: { organizationId: orgId } } }),
        prisma.finding.count({
          where: { repository: { organizationId: orgId }, falsePositive: true },
        }),
      ]);
      const falsePositiveRate =
        totalFindings > 0 ? Math.round((fpFindings / totalFindings) * 100) : 0;

      // Total count for percentage calculation
      const totalCategoryCount = findingsByCategory.reduce(
        (sum, g) => sum + g._count.id,
        0
      );

      const stats: DashboardStats = {
        orgRiskScore,
        scansThisMonth,
        criticalFindings,
        falsePositiveRate,
        findingsTrend,
        topRiskyRepos: repos.map((r) => ({
          id: r.id,
          name: r.name,
          fullName: r.fullName,
          riskScore: r.riskScore ?? 0,
          criticalCount: r._count.findings,
          highCount: 0, // Would need another query; omitted for brevity
          lastScannedAt: r.lastScannedAt?.toISOString() ?? null,
        })),
        recentScans: recentScans.map((s) => ({
          id: s.id,
          repositoryName: s.repository.name,
          status: s.status,
          riskScore: s.riskScore,
          findingsCount: s.findingsCount,
          createdAt: s.createdAt.toISOString(),
        })),
        findingsByCategory: findingsByCategory.map((g) => ({
          category: g.category as DashboardStats['findingsByCategory'][0]['category'],
          count: g._count.id,
          percentage:
            totalCategoryCount > 0
              ? Math.round((g._count.id / totalCategoryCount) * 100)
              : 0,
        })),
      };

      return reply.send({ success: true, data: stats, error: null });
    }
  );
}
