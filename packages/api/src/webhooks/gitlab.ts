/**
 * GitLab Webhook Handler
 *
 * Handles Merge Request and Push events from GitLab webhooks.
 *
 * SECURITY:
 *   - Verifies X-Gitlab-Token header (constant-time comparison)
 *   - Webhook secret read from env — never hardcoded
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { prisma } from '@codesheriff/db';
import { ScanStatus, ScanTrigger, Provider, QUEUE_NAMES } from '@codesheriff/shared';
import type { ScanJobPayload } from '@codesheriff/shared';

const GITLAB_TOKEN_HEADER = 'x-gitlab-token';
const GITLAB_EVENT_HEADER = 'x-gitlab-event';

interface GitLabMRPayload {
  object_kind: 'merge_request';
  object_attributes: {
    action: string;
    iid: number;
    title: string;
    source_branch: string;
    last_commit: { id: string };
  };
  project: { path_with_namespace: string; default_branch: string };
}

interface GitLabPushPayload {
  object_kind: 'push';
  ref: string;
  after: string;
  project: { path_with_namespace: string; default_branch: string };
}

export async function gitlabWebhookRoutes(app: FastifyInstance): Promise<void> {
  const webhookSecret = process.env['GITLAB_WEBHOOK_SECRET'];
  if (!webhookSecret) {
    app.log.warn('GITLAB_WEBHOOK_SECRET not set — GitLab webhooks disabled');
    return;
  }

  const scanQueue = new Queue<ScanJobPayload>(QUEUE_NAMES.SCAN, {
    connection: (app as unknown as { redis: ConnectionOptions }).redis,
  });

  app.post(
    '/gitlab',
    {
      config: {
        rateLimit: { max: 500, timeWindow: '1 minute' },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      // ----- Verify GitLab token (constant-time) -----
      const tokenHeader = req.headers[GITLAB_TOKEN_HEADER] as string | undefined;
      if (!tokenHeader || !verifyGitlabToken(tokenHeader, webhookSecret)) {
        req.log.warn('GitLab webhook token verification failed');
        return reply.status(401).send({ error: 'Invalid token' });
      }

      // Return 200 immediately
      void reply.status(200).send({ received: true });

      const eventType = req.headers[GITLAB_EVENT_HEADER] as string | undefined;

      try {
        switch (eventType) {
          case 'Merge Request Hook':
            await handleMergeRequest(req.body as GitLabMRPayload, scanQueue);
            break;

          case 'Push Hook':
            await handleGitlabPush(req.body as GitLabPushPayload, scanQueue);
            break;

          default:
            req.log.debug({ eventType }, 'unhandled GitLab event type');
        }
      } catch (err) {
        req.log.error({ err, eventType }, 'GitLab webhook processing error');
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleMergeRequest(
  payload: GitLabMRPayload,
  queue: Queue<ScanJobPayload>
): Promise<void> {
  const { action, iid, title, source_branch, last_commit } = payload.object_attributes;

  if (!['open', 'reopen', 'update'].includes(action)) return;

  const repo = await prisma.repository.findFirst({
    where: {
      provider: Provider.GITLAB,
      fullName: payload.project.path_with_namespace,
    },
    select: { id: true },
  });

  if (!repo) return;

  const scan = await prisma.scan.create({
    data: {
      repositoryId: repo.id,
      triggeredBy: ScanTrigger.PR,
      prNumber: iid,
      prTitle: title,
      branch: source_branch,
      commitSha: last_commit.id,
      status: ScanStatus.QUEUED,
    },
    select: { id: true },
  });

  await queue.add(
    'scan',
    {
      scanId: scan.id,
      repositoryId: repo.id,
      repoFullName: payload.project.path_with_namespace,
      provider: Provider.GITLAB,
      branch: source_branch,
      commitSha: last_commit.id,
      prNumber: iid,
      prTitle: title,
      installationId: null,
      enqueuedAt: new Date().toISOString(),
    },
    {
      jobId: `scan-${scan.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    }
  );
}

async function handleGitlabPush(
  payload: GitLabPushPayload,
  queue: Queue<ScanJobPayload>
): Promise<void> {
  const branch = payload.ref.replace('refs/heads/', '');

  const repo = await prisma.repository.findFirst({
    where: {
      provider: Provider.GITLAB,
      fullName: payload.project.path_with_namespace,
      defaultBranch: branch,
    },
    select: { id: true },
  });

  if (!repo) return;

  const scan = await prisma.scan.create({
    data: {
      repositoryId: repo.id,
      triggeredBy: ScanTrigger.PUSH,
      branch,
      commitSha: payload.after,
      status: ScanStatus.QUEUED,
    },
    select: { id: true },
  });

  await queue.add(
    'scan',
    {
      scanId: scan.id,
      repositoryId: repo.id,
      repoFullName: payload.project.path_with_namespace,
      provider: Provider.GITLAB,
      branch,
      commitSha: payload.after,
      prNumber: null,
      prTitle: null,
      installationId: null,
      enqueuedAt: new Date().toISOString(),
    },
    {
      jobId: `scan-${scan.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    }
  );
}

// ---------------------------------------------------------------------------
// Token verification (constant-time)
// ---------------------------------------------------------------------------

/**
 * Verify the GitLab X-Gitlab-Token header using constant-time comparison.
 *
 * KNOWN LIMITATION: GitLab's standard webhook token scheme authenticates
 * the sender but does NOT verify message integrity (no HMAC over the body).
 * A captured token can be replayed with a different payload. This is a
 * GitLab protocol constraint, not a code bug.
 *
 * MIGRATION PATH: GitLab 15.5+ supports X-Gitlab-Signature-256 (HMAC-SHA256
 * over the body). If your GitLab version supports it, migrate to that scheme:
 *   1. Set `rawBody: true` on the route (like the GitHub handler)
 *   2. Replace this function with an HMAC-SHA256 verification equivalent
 *      to `verifyGithubSignature` in webhooks/github.ts
 *
 * Until then, ensure the webhook secret is rotated regularly and webhook
 * deliveries are received over HTTPS only.
 */
function verifyGitlabToken(received: string, expected: string): boolean {
  try {
    const a = Buffer.from(received, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
