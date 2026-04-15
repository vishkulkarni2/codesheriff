/**
 * Admin route — operator-only stats endpoint.
 *
 * GET /api/v1/admin/stats
 *
 * Auth: X-Admin-Key header must match ADMIN_API_KEY env var.
 * Used by the lead-qualifier daemon and Vish for daily customer-count signal.
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '@codesheriff/db';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/v1/admin')) return;

    const adminKey = process.env['ADMIN_API_KEY'];
    if (!adminKey) {
      return reply.status(503).send({
        success: false,
        data: null,
        error: 'Admin endpoint not configured',
      });
    }

    const provided = req.headers['x-admin-key'];
    if (provided !== adminKey) {
      return reply.status(401).send({
        success: false,
        data: null,
        error: 'Unauthorized',
      });
    }
  });

  app.get('/admin/stats', async (_req, reply) => {
    const now = new Date();
    const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const month = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalOrgs,
      totalUsers,
      totalRepos,
      totalScans,
      signups24h,
      signups7d,
      signups30d,
      planBreakdown,
      scans24h,
      activeStripeSubs,
      recentSignups,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
      prisma.repository.count(),
      prisma.scan.count(),
      prisma.organization.count({ where: { createdAt: { gte: day } } }),
      prisma.organization.count({ where: { createdAt: { gte: week } } }),
      prisma.organization.count({ where: { createdAt: { gte: month } } }),
      prisma.organization.groupBy({
        by: ['plan'],
        _count: { plan: true },
      }),
      prisma.scan.count({ where: { createdAt: { gte: day } } }),
      prisma.organization.count({
        where: { stripeSubscriptionStatus: 'active' },
      }),
      prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          createdAt: true,
          stripeSubscriptionStatus: true,
          _count: { select: { users: true, repositories: true } },
        },
      }),
    ]);

    const plansByName: Record<string, number> = {};
    for (const row of planBreakdown) {
      plansByName[row.plan] = row._count.plan;
    }

    void reply.send({
      success: true,
      data: {
        totals: {
          orgs: totalOrgs,
          users: totalUsers,
          repos: totalRepos,
          scans: totalScans,
        },
        signups: {
          last24h: signups24h,
          last7d: signups7d,
          last30d: signups30d,
        },
        plans: plansByName,
        activeSubscriptions: activeStripeSubs,
        scansLast24h: scans24h,
        recentSignups: recentSignups.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          plan: o.plan,
          createdAt: o.createdAt,
          subStatus: o.stripeSubscriptionStatus,
          users: o._count.users,
          repos: o._count.repositories,
        })),
        timestamp: now.toISOString(),
      },
      error: null,
    });
  });
}
