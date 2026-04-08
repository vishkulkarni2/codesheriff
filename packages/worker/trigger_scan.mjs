import { Queue } from 'bullmq';
import { PrismaClient } from '@codesheriff/db';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
const REPO_FULL_NAME = process.argv[2] || 'vishkulkarni2/cs-test-nodejs';

const prisma = new PrismaClient();
const repo = await prisma.repository.findFirst({
  where: { fullName: REPO_FULL_NAME, organization: { plan: { not: 'FREE' } } },
  include: { organization: true },
});
if (!repo) throw new Error('repo not found on a non-FREE org');

console.log('using repo', repo.id, 'org', repo.organization.id, 'plan', repo.organization.plan);

const installationId = repo.organization.githubInstallationId;
if (!installationId) throw new Error('no githubInstallationId on org');

// Resolve branch HEAD via GitHub anon API (public repo)
const ghResp = await fetch(`https://api.github.com/repos/${REPO_FULL_NAME}/branches/main`);
const ghData = await ghResp.json();
const commitSha = ghData.commit.sha.toLowerCase();
console.log('branch HEAD sha:', commitSha);

const scan = await prisma.scan.create({
  data: {
    repositoryId: repo.id,
    triggeredBy: 'MANUAL',
    branch: 'main',
    commitSha,
    status: 'QUEUED',
  },
});
console.log('created scan', scan.id);

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue('scan', { connection });
await queue.add('scan', {
  scanId: scan.id,
  repositoryId: repo.id,
  repoFullName: REPO_FULL_NAME,
  provider: 'GITHUB',
  installationId,
  branch: 'main',
  commitSha,
  prNumber: null,
  prTitle: null,
  enqueuedAt: new Date().toISOString(),
});
console.log('enqueued — exiting');
await queue.close();
await connection.quit();
await prisma.$disconnect();
process.exit(0);
