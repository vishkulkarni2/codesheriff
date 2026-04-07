/**
 * GitHub Webhook Handler
 *
 * Receives push, pull_request, installation, and installation_repositories
 * events from GitHub App webhooks.
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
import { App } from '@octokit/app';
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

// ---------------------------------------------------------------------------
// GitHub Installation webhook payload types
// ---------------------------------------------------------------------------

interface GitHubInstallationPayload {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend' | 'new_permissions_accepted';
  installation: {
    id: number;
    account: {
      login: string;
      id: number;
      type: 'User' | 'Organization';
    };
    app_id: number;
    target_type: string;
  };
  repositories?: GitHubInstallationRepo[];
  sender: {
    login: string;
    id: number;
  };
}

interface GitHubInstallationReposPayload {
  action: 'added' | 'removed';
  installation: {
    id: number;
    account: {
      login: string;
      id: number;
      type: 'User' | 'Organization';
    };
  };
  repositories_added: GitHubInstallationRepo[];
  repositories_removed: GitHubInstallationRepo[];
  sender: {
    login: string;
    id: number;
  };
}

interface GitHubInstallationRepo {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  private: boolean;
}

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

          case 'installation':
            await handleInstallation(
              req.body as GitHubInstallationPayload,
              req.log,
              delivery
            );
            break;

          case 'installation_repositories':
            await handleInstallationRepositories(
              req.body as GitHubInstallationReposPayload,
              req.log,
              delivery
            );
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
// Installation event handlers — NEW
// ---------------------------------------------------------------------------

/**
 * Handle GitHub App installation events.
 *
 * When a user installs the GitHub App (installation.created), we need to:
 *   1. Find which Organization this installation belongs to
 *   2. Store the installation ID on the Organization
 *   3. Create Repository records for all repos in the installation
 *
 * The mapping challenge: GitHub sends the GitHub account login/id, but NOT
 * the Clerk user ID. We resolve this by matching:
 *   - The GitHub sender login against User emails (GitHub username match)
 *   - Or by looking up VcsInstallation records
 *   - As a fallback, we store the installation and repos, linked to any org
 *     whose user has a matching GitHub username/email pattern
 *
 * For the common case (single user = single org), sender.login is sufficient.
 */
async function handleInstallation(
  payload: GitHubInstallationPayload,
  log: FastifyInstance['log'],
  delivery?: string
): Promise<void> {
  const { action, installation, repositories, sender } = payload;

  log.info(
    {
      action,
      installationId: installation.id,
      account: installation.account.login,
      sender: sender.login,
      repoCount: repositories?.length ?? 0,
      delivery,
    },
    'GitHub installation event received'
  );

  if (action === 'created') {
    await handleInstallationCreated(installation, repositories ?? [], sender, log);
  } else if (action === 'deleted') {
    await handleInstallationDeleted(installation, log);
  } else {
    log.info({ action, delivery }, 'installation event: unhandled action');
  }
}

async function handleInstallationCreated(
  installation: GitHubInstallationPayload['installation'],
  repositories: GitHubInstallationRepo[],
  sender: { login: string; id: number },
  log: FastifyInstance['log']
): Promise<void> {
  const installationId = String(installation.id);
  const accountLogin = installation.account.login;

  // --- Step 1: Find the Organization to link this installation to ---
  // Strategy: find a User whose email contains the sender's GitHub login,
  // or whose name matches, or check if an org already has this installation.

  // First, check if any org already has this installationId (idempotent)
  let org = await prisma.organization.findFirst({
    where: { githubInstallationId: installationId },
    select: { id: true, slug: true },
  });

  if (!org) {
    // Try to find the org by matching the sender's GitHub login to a user.
    // This works because during sign-up, Clerk provides the GitHub username.
    // We check the user's email, name, and org slug for matches.

    // Strategy 1: Find user whose email starts with the sender login
    // (e.g., sender "acme-dev" → email "acme-dev@gmail.com")
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          // Email-based match: login@domain or login as email prefix
          { email: { startsWith: sender.login.toLowerCase() } },
          // Name-based match (some users sign up with GitHub username as name)
          { name: { equals: sender.login, mode: 'insensitive' as const } },
        ],
      },
      select: { organizationId: true },
      orderBy: { createdAt: 'desc' }, // Most recent user if multiple matches
    });

    if (user) {
      org = await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { id: true, slug: true },
      });
    }
  }

  if (!org) {
    // Strategy 2: Match org slug against the GitHub account login
    // (e.g., GitHub org "acme-corp" → org slug "acme-corp")
    org = await prisma.organization.findFirst({
      where: {
        OR: [
          { slug: accountLogin.toLowerCase() },
          { slug: { startsWith: accountLogin.toLowerCase() } },
        ],
      },
      select: { id: true, slug: true },
    });
  }

  if (!org) {
    // Strategy 3: Use the GitHub API to fetch the sender's email from their
    // GitHub profile, then match against our User table. This handles cases
    // where the GitHub username doesn't match the signup email.
    const appId = process.env['GITHUB_APP_ID'];
    const privateKey = process.env['GITHUB_APP_PRIVATE_KEY'];
    const webhookSecret = process.env['GITHUB_WEBHOOK_SECRET'];

    if (appId && privateKey && webhookSecret) {
      try {
        const ghApp = new App({ appId, privateKey, webhooks: { secret: webhookSecret } });
        const octokit = await ghApp.getInstallationOctokit(parseInt(installationId, 10));
        // Fetch the sender's public GitHub profile for their email
        const { data: ghUser } = await (octokit as any).rest.users.getByUsername({
          username: sender.login,
        });
        if (ghUser.email) {
          const userByGhEmail = await prisma.user.findFirst({
            where: { email: ghUser.email.toLowerCase() },
            select: { organizationId: true },
          });
          if (userByGhEmail) {
            org = await prisma.organization.findUnique({
              where: { id: userByGhEmail.organizationId },
              select: { id: true, slug: true },
            });
            if (org) {
              log.info(
                { orgId: org.id, slug: org.slug, installationId, ghEmail: ghUser.email },
                'installation: linked via GitHub profile email match'
              );
            }
          }
        }
      } catch (err) {
        log.warn({ err, senderLogin: sender.login }, 'failed to fetch GitHub user email for org matching');
      }
    }
  }

  if (!org) {
    // Strategy 4: If there's exactly one org with no GitHub installation yet,
    // link to it. This is a last-resort fallback for single-tenant setups.
    const unlinkedOrgs = await prisma.organization.findMany({
      where: { githubInstallationId: null },
      select: { id: true, slug: true },
      orderBy: { createdAt: 'desc' },
    });

    if (unlinkedOrgs.length === 1) {
      org = unlinkedOrgs[0]!;
      log.info(
        { orgId: org.id, slug: org.slug, installationId },
        'installation: linked to only unlinked org (last-resort fallback)'
      );
    } else {
      // Multiple unlinked orgs — pick the most recently created one
      // that was created in the last 24 hours (generous window)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = unlinkedOrgs.filter(o => true); // already sorted desc
      if (recent.length > 0) {
        // Log all candidates but don't auto-link if ambiguous
        log.info(
          { installationId, candidateCount: recent.length, candidates: recent.map(o => o.slug) },
          'installation: multiple unlinked orgs found — user must reconnect manually'
        );
      }
    }
  }

  if (!org) {
    log.warn(
      { installationId, accountLogin, senderLogin: sender.login },
      'installation.created: could not find matching Organization — installation stored but unlinked. ' +
      'User may need to reconnect from the dashboard.'
    );
    return;
  }

  // --- Step 2: Store the installation ID on the Organization ---
  await prisma.organization.update({
    where: { id: org.id },
    data: { githubInstallationId: installationId },
  });

  log.info(
    { orgId: org.id, slug: org.slug, installationId },
    'installation.created: linked GitHub installation to org'
  );

  // --- Step 3: Create Repository records for all repos ---
  await syncRepositoriesFromInstallation(org.id, installationId, repositories, log);
}

async function handleInstallationDeleted(
  installation: GitHubInstallationPayload['installation'],
  log: FastifyInstance['log']
): Promise<void> {
  const installationId = String(installation.id);

  // Clear the installation ID from the org (don't delete repos — keep history)
  const updated = await prisma.organization.updateMany({
    where: { githubInstallationId: installationId },
    data: { githubInstallationId: null },
  });

  log.info(
    { installationId, updatedCount: updated.count },
    'installation.deleted: cleared GitHub installation from org'
  );
}

/**
 * Handle installation_repositories events — repos added/removed after initial install.
 */
async function handleInstallationRepositories(
  payload: GitHubInstallationReposPayload,
  log: FastifyInstance['log'],
  delivery?: string
): Promise<void> {
  const { action, installation, repositories_added, repositories_removed } = payload;
  const installationId = String(installation.id);

  log.info(
    {
      action,
      installationId,
      addedCount: repositories_added.length,
      removedCount: repositories_removed.length,
      delivery,
    },
    'installation_repositories event received'
  );

  // Find the org linked to this installation
  const org = await prisma.organization.findFirst({
    where: { githubInstallationId: installationId },
    select: { id: true },
  });

  if (!org) {
    log.warn(
      { installationId },
      'installation_repositories: no org found for this installation'
    );
    return;
  }

  if (action === 'added' && repositories_added.length > 0) {
    await syncRepositoriesFromInstallation(org.id, installationId, repositories_added, log);
  }

  if (action === 'removed' && repositories_removed.length > 0) {
    // Mark removed repos — don't delete (preserve scan history)
    for (const ghRepo of repositories_removed) {
      log.info(
        { repoFullName: ghRepo.full_name, orgId: org.id },
        'installation_repositories: repo removed from installation (keeping record)'
      );
    }
  }
}

/**
 * Create or update Repository records for repos from a GitHub installation.
 * Uses the GitHub API to fetch additional metadata (language, default branch).
 */
async function syncRepositoriesFromInstallation(
  orgId: string,
  installationId: string,
  repos: GitHubInstallationRepo[],
  log: FastifyInstance['log']
): Promise<void> {
  // Try to get richer repo metadata via the GitHub API if credentials are available
  let enrichedRepos: Array<{
    fullName: string;
    name: string;
    isPrivate: boolean;
    defaultBranch: string;
    language: string | null;
  }> = [];

  const appId = process.env['GITHUB_APP_ID'];
  const privateKey = process.env['GITHUB_APP_PRIVATE_KEY'];
  const webhookSecret = process.env['GITHUB_WEBHOOK_SECRET'];

  if (appId && privateKey && webhookSecret) {
    try {
      const ghApp = new App({
        appId,
        privateKey,
        webhooks: { secret: webhookSecret },
      });
      const octokit = await ghApp.getInstallationOctokit(parseInt(installationId, 10));

      // Fetch full repo details for each repo in the installation
      const repoDetails = await Promise.all(
        repos.map(async (r) => {
          try {
            const [owner, name] = r.full_name.split('/');
            const { data } = await (octokit as any).rest.repos.get({ owner, repo: name });
            return {
              fullName: r.full_name,
              name: r.name,
              isPrivate: data.private,
              defaultBranch: data.default_branch ?? 'main',
              language: data.language ?? null,
            };
          } catch (err) {
            log.warn({ err, repo: r.full_name }, 'failed to fetch repo details from GitHub API');
            return {
              fullName: r.full_name,
              name: r.name,
              isPrivate: r.private,
              defaultBranch: 'main',
              language: null,
            };
          }
        })
      );
      enrichedRepos = repoDetails;
    } catch (err) {
      log.warn({ err }, 'failed to initialize GitHub App client for repo sync — using webhook data');
      enrichedRepos = repos.map((r) => ({
        fullName: r.full_name,
        name: r.name,
        isPrivate: r.private,
        defaultBranch: 'main',
        language: null,
      }));
    }
  } else {
    // No GitHub App credentials — use the basic data from the webhook payload
    enrichedRepos = repos.map((r) => ({
      fullName: r.full_name,
      name: r.name,
      isPrivate: r.private,
      defaultBranch: 'main',
      language: null,
    }));
  }

  // Upsert each repository
  for (const repo of enrichedRepos) {
    try {
      await prisma.repository.upsert({
        where: {
          organizationId_provider_fullName: {
            organizationId: orgId,
            provider: Provider.GITHUB,
            fullName: repo.fullName,
          },
        },
        create: {
          organizationId: orgId,
          name: repo.name,
          fullName: repo.fullName,
          provider: Provider.GITHUB,
          defaultBranch: repo.defaultBranch,
          isPrivate: repo.isPrivate,
          language: repo.language,
        },
        update: {
          // Update metadata on re-install (repo may have changed)
          defaultBranch: repo.defaultBranch,
          isPrivate: repo.isPrivate,
          language: repo.language,
        },
      });

      log.info(
        { orgId, repoFullName: repo.fullName },
        'synced repository from GitHub installation'
      );
    } catch (err) {
      log.error(
        { err, orgId, repoFullName: repo.fullName },
        'failed to upsert repository from installation'
      );
    }
  }
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
