/**
 * CodeSheriff Scan Worker — Entry Point
 *
 * BullMQ consumer that processes scan jobs from the queue.
 * Runs as a separate process from the API server.
 *
 * SECURITY:
 *   - Private key read from env — never hardcoded or logged
 *   - Graceful shutdown drains in-flight jobs before exiting
 */

import { Worker, Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAMES } from '@codesheriff/shared';
import type { ScanJobPayload } from '@codesheriff/shared';
import { processScanJob } from './processors/scan-processor.js';
import { processDigestJob } from './processors/digest-processor.js';
import { GitHubClient } from './services/github-client.js';
import { GitLabClient } from './services/gitlab-client.js';
import { logger } from './utils/logger.js';

function assertRequiredEnv(keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.error({ missing }, 'required environment variables not set');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  assertRequiredEnv([
    'DATABASE_URL',
    'REDIS_URL',
    'ANTHROPIC_API_KEY',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_WEBHOOK_SECRET',
  ]);

  const redis = new Redis(process.env['REDIS_URL']!, {
    maxRetriesPerRequest: null, // Required for BullMQ
    lazyConnect: false,
    enableReadyCheck: true,
  });

  redis.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
  });

  const githubClient = new GitHubClient({
    appId: process.env['GITHUB_APP_ID']!,
    // Private key may be base64-encoded in env — decode if needed
    privateKey: decodePrivateKey(process.env['GITHUB_APP_PRIVATE_KEY']!),
    webhookSecret: process.env['GITHUB_WEBHOOK_SECRET']!,
  });

  // GitLab client — stateless, tokens are fetched per-scan from VcsInstallation.
  // Override GITLAB_BASE_URL for self-hosted instances.
  const gitlabClient = new GitLabClient(
    process.env['GITLAB_BASE_URL'] ?? 'https://gitlab.com'
  );

  const worker = new Worker<ScanJobPayload>(
    QUEUE_NAMES.SCAN,
    async (job) => {
      return processScanJob(job, { redis, githubClient, gitlabClient });
    },
    {
      connection: redis as unknown as ConnectionOptions,
      concurrency: parseInt(process.env['WORKER_CONCURRENCY'] ?? '3', 10),
      limiter: {
        max: 10,
        duration: 60_000, // Max 10 scans per minute per worker
      },
    }
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, scanId: job.data.scanId }, 'scan job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, scanId: job?.data.scanId, err },
      'scan job failed'
    );
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'BullMQ worker error');
  });

  // ── Weekly digest — runs every Monday at 08:00 UTC ───────────────────────
  const digestQueue = new Queue(QUEUE_NAMES.DIGEST, { connection: redis as unknown as ConnectionOptions });

  // Upsert the repeatable job so restarts don't create duplicates
  await digestQueue.add(
    'weekly-digest',
    {},
    {
      repeat: { pattern: '0 8 * * 1' }, // cron: Monday 08:00 UTC
      jobId: 'weekly-digest',            // stable ID prevents duplicates
    }
  );

  const digestWorker = new Worker(
    QUEUE_NAMES.DIGEST,
    async () => processDigestJob(logger),
    { connection: redis as unknown as ConnectionOptions }
  );

  digestWorker.on('completed', () => logger.info('weekly digest job completed'));
  digestWorker.on('failed', (_job, err) => logger.error({ err }, 'weekly digest job failed'));

  logger.info(
    { concurrency: parseInt(process.env['WORKER_CONCURRENCY'] ?? '3', 10) },
    'CodeSheriff worker started'
  );

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown signal received — draining worker');
    await worker.close();
    await digestWorker.close();
    await digestQueue.close();
    await redis.quit();
    logger.info('worker shut down cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

/**
 * Decode a GitHub App private key that may be base64-encoded in the environment.
 * GitHub App private keys contain newlines which can't be set directly in many
 * deployment platforms — base64 encoding is common.
 */
function decodePrivateKey(raw: string): string {
  if (raw.startsWith('-----BEGIN')) {
    return raw.replace(/\\n/g, '\n');
  }
  // Assume base64-encoded PEM
  return Buffer.from(raw, 'base64').toString('utf8');
}

void main();
