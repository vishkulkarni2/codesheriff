/**
 * Repository routes
 *
 * GET /api/v1/repos              — list org repositories
 * GET /api/v1/repos/:id          — single repo detail
 * GET /api/v1/repos/:id/risk-history — daily risk scores for chart
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codesheriff/db';
import { verifyRepoOwnership } from '../middleware/ownership.js';
import { App } from '@octokit/app';

const riskHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(90),
});

export async function repoRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // GET /api/v1/repos
  // ---------------------------------------------------------------------------
  app.get('/repos', { preHandler: [app.authenticate] }, async (req, reply) => {
    const orgId = req.dbUser!.organizationId;

    const repos = await prisma.repository.findMany({
      where: { organizationId: orgId },
      orderBy: [{ riskScore: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        fullName: true,
        provider: true,
        language: true,
        riskScore: true,
        lastScannedAt: true,
        isPrivate: true,
        defaultBranch: true,
        _count: { select: { scans: true } },
      },
    });

    return reply.send({ success: true, data: repos, error: null });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/repos/:id
  // ---------------------------------------------------------------------------
  app.get('/repos/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    // IDOR prevention: single query that combines ownership verification with
    // data fetch — avoids a TOCTOU race between a separate ownership check
    // and a subsequent unconstrained findUnique.
    const repo = await prisma.repository.findFirst({
      where: {
        id,
        organizationId: req.dbUser!.organizationId, // ownership enforced in DB query
      },
      include: {
        _count: {
          select: {
            scans: true,
            findings: { where: { falsePositive: false, suppressed: false } },
          },
        },
        scans: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            riskScore: true,
            findingsCount: true,
            triggeredBy: true,
            branch: true,
            createdAt: true,
          },
        },
      },
    });

    if (!repo) {
      return reply.status(404).send({ success: false, data: null, error: 'Repository not found' });
    }

    return reply.send({ success: true, data: repo, error: null });
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/repos/:id/risk-history
  // ---------------------------------------------------------------------------
  app.get(
    '/repos/:id/risk-history',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      // IDOR prevention: ownership check
      const owned = await verifyRepoOwnership(req, reply, id);
      if (!owned) return;

      const queryParsed = riskHistoryQuerySchema.safeParse(req.query);
      if (!queryParsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: 'Invalid query parameters',
        });
      }

      const { days } = queryParsed.data;
      const since = new Date();
      since.setDate(since.getDate() - days);
      since.setHours(0, 0, 0, 0);

      const history = await prisma.riskHistory.findMany({
        where: { repositoryId: id, date: { gte: since } },
        orderBy: { date: 'asc' },
        select: { date: true, riskScore: true },
      });

      const data = history.map((h) => ({
        date: h.date.toISOString().slice(0, 10),
        riskScore: h.riskScore,
      }));

      return reply.send({ success: true, data, error: null });
    }
  );

  // ---------------------------------------------------------------------------
  // GET /api/v1/repos/:id/branches — list branches via the GitHub App
  // ---------------------------------------------------------------------------
  app.get(
    '/repos/:id/branches',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      // IDOR prevention: verify the org owns this repo before exposing branch names
      const repo = await prisma.repository.findFirst({
        where: { id, organizationId: req.dbUser!.organizationId },
        select: {
          fullName: true,
          defaultBranch: true,
          provider: true,
          organization: { select: { githubInstallationId: true } },
        },
      });

      if (!repo) {
        return reply
          .status(404)
          .send({ success: false, data: null, error: 'Repository not found' });
      }

      const installationId = repo.organization.githubInstallationId;
      if (!installationId) {
        // Graceful degradation: return just the default branch so the UI
        // still has something to pre-fill, with a flag indicating it could
        // not enumerate the full list.
        return reply.send({
          success: true,
          data: {
            defaultBranch: repo.defaultBranch,
            branches: [repo.defaultBranch],
            partial: true,
          },
          error: null,
        });
      }

      const appId = process.env['GITHUB_APP_ID'];
      const privateKey = process.env['GITHUB_APP_PRIVATE_KEY'];
      const webhookSecret = process.env['GITHUB_WEBHOOK_SECRET'];
      if (!appId || !privateKey || !webhookSecret) {
        return reply.status(500).send({
          success: false,
          data: null,
          error: 'GitHub App credentials not configured on the server',
        });
      }

      const [owner, name] = repo.fullName.split('/');
      if (!owner || !name) {
        return reply.status(500).send({
          success: false,
          data: null,
          error: `Malformed repository fullName: ${repo.fullName}`,
        });
      }

      try {
        const ghApp = new App({
          appId,
          privateKey,
          webhooks: { secret: webhookSecret },
        });
        const octokit = await ghApp.getInstallationOctokit(
          parseInt(installationId, 10)
        );
        // Walk pages — most repos have <100 branches; cap at 300 to be safe
        const branches: string[] = [];
        for (let page = 1; page <= 3; page++) {
          const { data } = await (octokit as unknown as {
            request: (route: string, params: Record<string, unknown>) => Promise<{
              data: Array<{ name: string }>;
            }>;
          }).request('GET /repos/{owner}/{repo}/branches', {
            owner,
            repo: name,
            per_page: 100,
            page,
          });
          for (const b of data) {
            if (typeof b.name === 'string') branches.push(b.name);
          }
          if (data.length < 100) break;
        }

        return reply.send({
          success: true,
          data: {
            defaultBranch: repo.defaultBranch,
            branches,
            partial: false,
          },
          error: null,
        });
      } catch (err) {
        req.log.warn(
          { err, repoId: id },
          'failed to fetch branches via GitHub App'
        );
        // Fail soft so the UI still works — caller can fall back to text input
        return reply.send({
          success: true,
          data: {
            defaultBranch: repo.defaultBranch,
            branches: [repo.defaultBranch],
            partial: true,
          },
          error: null,
        });
      }
    }
  );
}
