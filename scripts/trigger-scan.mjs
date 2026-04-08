#!/usr/bin/env node
// Manual scan trigger — bypasses the API to enqueue directly via DB + BullMQ.
// Resolves the branch HEAD via the GitHub App, just like the API does.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../packages/db/dist/index.js');
const { Queue } = require('../packages/worker/node_modules/bullmq');
const IORedis = require('../packages/worker/node_modules/ioredis');
const { App } = require('../packages/worker/node_modules/@octokit/app');

const repoFullName = process.argv[2];
const branch = process.argv[3] ?? 'main';

if (!repoFullName) {
  console.error('usage: node trigger-scan.mjs <owner/repo> [branch]');
  process.exit(1);
}

const prisma = new PrismaClient();
const repo = await prisma.repository.findFirst({
  where: { fullName: repoFullName },
  select: {
    id: true,
    fullName: true,
    provider: true,
    organizationId: true,
    organization: { select: { githubInstallationId: true } },
  },
});
if (!repo) {
  console.error('repo not found:', repoFullName);
  process.exit(1);
}
console.log('repo:', repo.id, repo.fullName, 'installation:', repo.organization.githubInstallationId);

const installationId = repo.organization.githubInstallationId;
if (!installationId) {
  console.error('no githubInstallationId on org');
  process.exit(1);
}

const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
if (!appId || !privateKey || !webhookSecret) {
  console.error('missing GITHUB_APP_* env vars');
  process.exit(1);
}

const ghApp = new App({ appId, privateKey, webhooks: { secret: webhookSecret } });
const octokit = await ghApp.getInstallationOctokit(parseInt(installationId, 10));
const [owner, name] = repo.fullName.split('/');
const { data: branchData } = await octokit.request(
  'GET /repos/{owner}/{repo}/branches/{branch}',
  { owner, repo: name, branch }
);
const commitSha = branchData.commit.sha.toLowerCase();
console.log('resolved HEAD:', commitSha);

const scan = await prisma.scan.create({
  data: {
    repositoryId: repo.id,
    triggeredBy: 'MANUAL',
    branch,
    commitSha,
    status: 'QUEUED',
  },
  select: { id: true },
});
console.log('created scan:', scan.id);

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('REDIS_URL not set');
  process.exit(1);
}
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, tls: redisUrl.startsWith('rediss://') ? {} : undefined });
const queue = new Queue('scan', { connection });

await queue.add('scan', {
  scanId: scan.id,
  repositoryId: repo.id,
  repoFullName: repo.fullName,
  provider: repo.provider,
  installationId,
  commitSha,
  branch,
  prNumber: null,
});
console.log('enqueued job for scan', scan.id);

await queue.close();
await connection.quit();
await prisma.$disconnect();
