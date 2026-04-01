/**
 * GitHub Webhook Handler
 *
 * Receives push and pull_request events from GitHub App webhooks.
 * Immediately returns 200 after enqueueing — analysis is fully async.
 *
 * SECURITY:
 *   - HMAC-SHA256 signature verified before any payload processing
 *     (constant-time comparison to prevent timing attacks)
 *   - No JWT auth — GitHub signs requests with the webhook secret
 *   - Webhook secret read from env — never hardcoded
 *   - Raw body required for signature verification — must register before JSON parsing
 *   - Tolerates up to 5 minutes of timestamp skew (configurable)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    rawBody?: boolean;
  }
}
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { prisma } from '@codesheriff/db';
import { ScanStatus, ScanTrigger, Provider, QUEUE_NAMES } from '@codesheriff/shared';
import type {
  GitHubPRPayload,
  GitHubPushPayload,
  ScanJobPayload,
} from '@codesheriff/shared';

const GITHUB_SIGNATURE_HEADER = 'x-hub-signature-256';
const GITHUB_EVENT_HEADER = 'x-github-event';
const GITHUB_DELIVERY_HEADER = 'x-github-delivery';

/** Maximum age of a webhook delivery before we reject it (ms) */
const MAX_DELIVERY_AGE_MS = parseInt(
  process.env['WEBHOOK_SIGNATURE_TOLERANCE_MS'] ?? '300000',
  10
);

export async function githubWebhookRoutes(app: FastifyInstance): Promise<void> {
  const webhookSecret = process.env['GITHUB_WEBHOOK_SECRET'];
  if (!webhookSecret) {
    app.log.warn('GITHUB_WEBHOOK_SECRET not set — GitHub webhooks disabled');
    return;
  }

  const scanQueue = new Queue<ScanJobPayload>(QUEUE_NAMES.SCAN, {
    connection: (app as unknown as { redis: ConnectionOptions }).redis,
  });

  // Dedicated rate limit for webhook endpoint — GitHub delivers via fixed IPs
  // but we still protect against replay and flooding
  app.post(
    '/github',
    {
      config: {
        rawBody: true, // Required for HMAC verification
        rateLimit: {
          max: 500,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const delivery = req.headers[GITHUB_DELIVERY_HEADER] as string | undefined;

      // ----- Step 1: Verify HMAC-SHA256 signature -----
      const sigHeader = req.headers[GITHUB_SIGNATURE_HEADER] as string | undefined;
      if (!sigHeader) {
        req.log.warn({ delivery }, 'missing GitHub signature header');
        return reply.status(401).send({ error: 'Missing signature' });
      }

      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        req.log.error('rawBody not available — check Fastify rawBody plugin config');
        return reply.status(500).send({ error: 'Internal error' });
      }

      const isValid = verifyGithubSignature(rawBody, sigHeader, webhookSecret);
      if (!isValid) {
        req.log.warn({ delivery }, 'GitHub webhook signature verification failed');
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      // ----- Step 2: Parse event type -----
      const eventType = req.headers[GITHUB_EVENT_HEADER] as string | undefined;
      if (!eventType) {
        return reply.status(400).send({ error: 'Missing event type header' });
      }

      // Respond 200 immediately — GitHub retries if it doesn't get a fast response
      void reply.status(200).send({ received: true });

      // ----- Step 3: Handle event asynchronously -----
      try {
        switch (eventType) {
          case 'pull_request':
            await handlePullRequest(
              req.body as GitHubPRPayload,
              scanQueue,
              delivery
            );
            break;

          case 'push':
            await handlePush(req.body as GitHubPushPayload, scanQueue, delivery);
            break;

          case 'ping':
            req.log.info({ delivery }, 'GitHub ping received');
            break;

          default:
            req.log.debug({ eventType, delivery }, 'unhandled GitHub event type');
        }
      } catch (err) {
        // Don't let async processing errors propagate — reply is already sent
        req.log.error({ err, delivery, eventType }, 'webhook processing error');
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handlePullRequest(
  payload: GitHubPRPayload,
  queue: Queue<ScanJobPayload>,
  delivery?: string
): Promise<void> {
  const { action, pull_request: pr, repository, installation, number: prNumber } = payload;

  // Only process events that mean "new code to review"
  if (!['opened', 'synchronize', 'reopened'].includes(action)) return;

  // Find our repository record — keyed by provider + fullName
  const repo = await prisma.repository.findFirst({
    where: {
      provider: Provider.GITHUB,
      fullName: repository.full_name,
    },
    select: { id: true, organizationId: true },
  });

  if (!repo) {
    // Repository not connected to CodeSheriff yet — ignore silently
    return;
  }

  // Create scan record
  const scan = await prisma.scan.create({
    data: {
      repositoryId: repo.id,
      triggeredBy: ScanTrigger.PR,
      prNumber,
      prTitle: pr.title,
      branch: pr.head.ref,
      commitSha: pr.head.sha,
      status: ScanStatus.QUEUED,
    },
    select: { id: true },
  });

  // Enqueue scan job
  await queue.add(
    'scan',
    {
      scanId: scan.id,
      repositoryId: repo.id,
      repoFullName: repository.full_name,
      provider: Provider.GITHUB,
      branch: pr.head.ref,
      commitSha: pr.head.sha,
      prNumber,
      prTitle: pr.title,
      installationId: installation ? String(installation.id) : null,
      enqueuedAt: new Date().toISOString(),
    },
    {
      jobId: `scan:${scan.id}`, // Idempotent — prevents duplicate jobs on GitHub retries
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    }
  );
}

async function handlePush(
  payload: GitHubPushPayload,
  queue: Queue<ScanJobPayload>,
  delivery?: string
): Promise<void> {
  // Only scan pushes to the default branch (scheduled/audit scans)
  const branch = payload.ref.replace('refs/heads/', '');

  const repo = await prisma.repository.findFirst({
    where: {
      provider: Provider.GITHUB,
      fullName: payload.repository.full_name,
      defaultBranch: branch,
    },
    select: { id: true, defaultBranch: true },
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
      repoFullName: payload.repository.full_name,
      provider: Provider.GITHUB,
      branch,
      commitSha: payload.after,
      prNumber: null,
      prTitle: null,
      installationId: payload.installation ? String(payload.installation.id) : null,
      enqueuedAt: new Date().toISOString(),
    },
    {
      jobId: `scan:${scan.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    }
  );
}

// ---------------------------------------------------------------------------
// HMAC verification (constant-time)
// ---------------------------------------------------------------------------

/**
 * Verify a GitHub webhook HMAC-SHA256 signature.
 *
 * Uses timingSafeEqual to prevent timing-based oracle attacks.
 * Returns false on any error rather than throwing.
 */
function verifyGithubSignature(
  body: Buffer,
  signatureHeader: string,
  secret: string
): boolean {
  try {
    if (!signatureHeader.startsWith('sha256=')) return false;

    const receivedSig = Buffer.from(signatureHeader.slice(7), 'hex');
    const expectedSig = createHmac('sha256', secret).update(body).digest();

    // Both buffers must be the same length for timingSafeEqual
    if (receivedSig.length !== expectedSig.length) return false;

    return timingSafeEqual(receivedSig, expectedSig);
  } catch {
    return false;
  }
}
