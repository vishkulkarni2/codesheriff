/**
 * Ownership verification helpers.
 *
 * Every resource access that uses a user-supplied ID MUST go through one of
 * these helpers to prevent IDOR (Insecure Direct Object Reference) attacks.
 *
 * Pattern enforced: never query `{ where: { id: req.params.id } }` directly.
 * Always include `organizationId` in the where clause.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@codesheriff/db';

/**
 * Verify that a repository belongs to the authenticated user's organization.
 * Returns the repository or sends a 403/404 response and returns null.
 *
 * @param repoId - User-supplied repository ID from req.params
 */
export async function verifyRepoOwnership(
  req: FastifyRequest,
  reply: FastifyReply,
  repoId: string
): Promise<{ id: string; organizationId: string } | null> {
  if (!req.dbUser) {
    void reply.status(401).send({ success: false, data: null, error: 'Unauthenticated' });
    return null;
  }

  // IDOR prevention: always filter by organizationId from the verified JWT,
  // never trust the organizationId from the request body or params
  const repo = await prisma.repository.findFirst({
    where: {
      id: repoId,
      organizationId: req.dbUser.organizationId, // Must match authenticated user's org
    },
    select: { id: true, organizationId: true },
  });

  if (!repo) {
    // Return 404 (not 403) to avoid leaking whether the resource exists
    void reply.status(404).send({ success: false, data: null, error: 'Repository not found' });
    return null;
  }

  return repo;
}

/**
 * Verify that a scan belongs to the authenticated user's organization
 * (via the scan → repository → organization chain).
 */
export async function verifyScanOwnership(
  req: FastifyRequest,
  reply: FastifyReply,
  scanId: string
): Promise<{ id: string; repositoryId: string; repository: { organizationId: string } } | null> {
  if (!req.dbUser) {
    void reply.status(401).send({ success: false, data: null, error: 'Unauthenticated' });
    return null;
  }

  const scan = await prisma.scan.findFirst({
    where: {
      id: scanId,
      repository: {
        organizationId: req.dbUser.organizationId,
      },
    },
    select: {
      id: true,
      repositoryId: true,
      repository: { select: { organizationId: true } },
    },
  });

  if (!scan) {
    void reply.status(404).send({ success: false, data: null, error: 'Scan not found' });
    return null;
  }

  return scan;
}

/**
 * Verify that a finding belongs to the authenticated user's organization.
 */
export async function verifyFindingOwnership(
  req: FastifyRequest,
  reply: FastifyReply,
  findingId: string
): Promise<{ id: string } | null> {
  if (!req.dbUser) {
    void reply.status(401).send({ success: false, data: null, error: 'Unauthenticated' });
    return null;
  }

  const finding = await prisma.finding.findFirst({
    where: {
      id: findingId,
      repository: {
        organizationId: req.dbUser.organizationId,
      },
    },
    select: { id: true },
  });

  if (!finding) {
    void reply.status(404).send({ success: false, data: null, error: 'Finding not found' });
    return null;
  }

  return finding;
}

/**
 * Verify that a rule belongs to the authenticated user's organization
 * (or is a global rule, which all orgs can read but not modify).
 */
export async function verifyRuleOwnership(
  req: FastifyRequest,
  reply: FastifyReply,
  ruleId: string,
  { allowGlobal }: { allowGlobal: boolean } = { allowGlobal: false }
): Promise<{ id: string; organizationId: string | null } | null> {
  if (!req.dbUser) {
    void reply.status(401).send({ success: false, data: null, error: 'Unauthenticated' });
    return null;
  }

  const rule = await prisma.rule.findFirst({
    where: {
      id: ruleId,
      OR: [
        { organizationId: req.dbUser.organizationId },
        ...(allowGlobal ? [{ organizationId: null }] : []),
      ],
    },
    select: { id: true, organizationId: true },
  });

  if (!rule) {
    void reply.status(404).send({ success: false, data: null, error: 'Rule not found' });
    return null;
  }

  return rule;
}
