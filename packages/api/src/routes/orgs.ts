/**
 * Organization routes
 *
 * GET    /api/v1/orgs/current              — get authenticated user's org
 * PATCH  /api/v1/orgs/current              — update org settings (OWNER/ADMIN only)
 * PUT    /api/v1/orgs/current/vcs/gitlab   — save/rotate GitLab access token (OWNER/ADMIN)
 * DELETE /api/v1/orgs/current/vcs/gitlab   — remove GitLab token + disconnect (OWNER only)
 * GET    /api/v1/orgs/current/vcs/gitlab   — check connection status (no token returned)
 *
 * Updatable fields on PATCH /orgs/current:
 *   - name            : display name (OWNER only)
 *   - slackWebhookUrl : Slack incoming webhook for post-scan notifications
 *                       (OWNER or ADMIN). Pass null to clear.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codesheriff/db';
import { UserRole, Provider } from '@codesheriff/shared';
import { encryptToken } from '../utils/token-crypto.js';

/** Validates a Slack incoming webhook URL, or null to clear. */
const slackWebhookUrlSchema = z
  .string()
  .url('slackWebhookUrl must be a valid URL')
  .regex(
    /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+$/,
    'slackWebhookUrl must be a valid Slack incoming webhook URL (https://hooks.slack.com/services/…)'
  )
  .nullable()
  .optional();

const updateOrgSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    slackWebhookUrl: slackWebhookUrlSchema,
  })
  .refine((d) => Object.keys(d).some((k) => d[k as keyof typeof d] !== undefined), {
    message: 'At least one field required',
  });

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // GET /api/v1/orgs/current
  // ---------------------------------------------------------------------------
  app.get('/orgs/current', { preHandler: [app.authenticate] }, async (req, reply) => {
    const orgId = req.dbUser!.organizationId;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        seats: true,
        slackWebhookUrl: true,
        githubInstallationId: true,
        gitlabGroupId: true,
        createdAt: true,
        updatedAt: true,
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: {
            repositories: true,
          },
        },
      },
    });

    if (!org) {
      return reply.status(404).send({
        success: false,
        data: null,
        error: 'Organization not found',
      });
    }

    return reply.send({ success: true, data: org, error: null });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/orgs/current — OWNER only
  // ---------------------------------------------------------------------------
  app.patch(
    '/orgs/current',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.dbUser!;

      // MEMBER cannot change any org settings
      if (role === UserRole.MEMBER) {
        return reply.status(403).send({
          success: false,
          data: null,
          error: 'Only org owners and admins can update organization settings',
        });
      }

      const parsed = updateOrgSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      // Name changes are restricted to OWNER
      if (parsed.data.name !== undefined && role !== UserRole.OWNER) {
        return reply.status(403).send({
          success: false,
          data: null,
          error: 'Only org owners can rename the organization',
        });
      }

      // Build update payload — explicit undefined-skipping to avoid overwriting
      // fields that weren't included in the request body.
      const updateData: Record<string, string | null> = {};
      if (parsed.data.name !== undefined) updateData['name'] = parsed.data.name;
      if (parsed.data.slackWebhookUrl !== undefined) {
        // null clears the webhook; a string value sets it
        updateData['slackWebhookUrl'] = parsed.data.slackWebhookUrl;
      }

      // Org ID comes from verified JWT — never from request body
      const updated = await prisma.organization.update({
        where: { id: req.dbUser!.organizationId },
        data: updateData,
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          seats: true,
          slackWebhookUrl: true,
          updatedAt: true,
        },
      });

      return reply.send({ success: true, data: updated, error: null });
    }
  );

  // ---------------------------------------------------------------------------
  // GET /api/v1/orgs/current/vcs/gitlab — connection status (no token returned)
  // ---------------------------------------------------------------------------
  app.get(
    '/orgs/current/vcs/gitlab',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const orgId = req.dbUser!.organizationId;

      const vcs = await prisma.vcsInstallation.findUnique({
        where: { organizationId_provider: { organizationId: orgId, provider: Provider.GITLAB } },
        select: { id: true, updatedAt: true, tokenExpiresAt: true },
      });

      return reply.send({
        success: true,
        data: {
          connected: vcs !== null,
          // Never return the token — only metadata
          configuredAt: vcs?.updatedAt ?? null,
          tokenExpiresAt: vcs?.tokenExpiresAt ?? null,
        },
        error: null,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // PUT /api/v1/orgs/current/vcs/gitlab — save or rotate GitLab access token
  //
  // OWNER or ADMIN only. Accepts a plaintext token from the UI, encrypts it
  // with AES-256-GCM, and upserts the VcsInstallation row for this org.
  // The raw token is never logged or stored.
  // ---------------------------------------------------------------------------
  const gitlabTokenSchema = z.object({
    /** GitLab Personal Access Token or Group Access Token — scopes: read_api, read_repository */
    token: z.string().min(10, 'Token must be at least 10 characters'),
    /** Optional: ISO-8601 expiry date if the token has a fixed expiry */
    expiresAt: z.string().datetime({ offset: true }).optional(),
  });

  app.put(
    '/orgs/current/vcs/gitlab',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { role, organizationId } = req.dbUser!;

      if (role === UserRole.MEMBER) {
        return reply.status(403).send({
          success: false,
          data: null,
          error: 'Only org owners and admins can configure VCS connections',
        });
      }

      const parsed = gitlabTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      const { token, expiresAt } = parsed.data;

      // Encrypt before writing — raw token never touches the DB
      let encryptedToken: string;
      try {
        encryptedToken = encryptToken(token);
      } catch (err) {
        req.log.error({ err }, 'Token encryption failed — TOKEN_ENCRYPTION_KEY may not be set');
        return reply.status(500).send({
          success: false,
          data: null,
          error: 'Server configuration error — token encryption not available',
        });
      }

      // Upsert: creates a new row or rotates the existing token
      await prisma.vcsInstallation.upsert({
        where: {
          organizationId_provider: { organizationId, provider: Provider.GITLAB },
        },
        create: {
          organizationId,
          provider: Provider.GITLAB,
          installationId: organizationId, // GitLab has no App installation ID — use orgId as key
          encryptedToken,
          tokenExpiresAt: expiresAt ? new Date(expiresAt) : null,
        },
        update: {
          encryptedToken,
          tokenExpiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      });

      return reply.send({
        success: true,
        data: { connected: true },
        error: null,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/v1/orgs/current/vcs/gitlab — disconnect GitLab (OWNER only)
  // ---------------------------------------------------------------------------
  app.delete(
    '/orgs/current/vcs/gitlab',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { role, organizationId } = req.dbUser!;

      if (role !== UserRole.OWNER) {
        return reply.status(403).send({
          success: false,
          data: null,
          error: 'Only org owners can remove VCS connections',
        });
      }

      await prisma.vcsInstallation.deleteMany({
        where: { organizationId, provider: Provider.GITLAB },
      });

      return reply.status(204).send();
    }
  );
}
