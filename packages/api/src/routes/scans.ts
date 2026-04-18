/**
 * Scan routes
 *
 * GET  /api/v1/scans             — list scans (optional repositoryId filter)
 * POST /api/v1/scans            — trigger a manual scan
 * GET  /api/v1/scans/:id        — get scan + paginated findings
 * GET  /api/v1/scans/:id/sarif  — export full scan as SARIF 2.1.0 JSON
 *
 * SECURITY:
 *   - All routes require authenticated user (Clerk JWT, server-side verified)
 *   - Scan lookup uses org-scoped findFirst (IDOR prevention)
 *   - Manual scans are only allowed on repos the user's org owns
 *   - BullMQ job is enqueued — no synchronous analysis in the request path
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { prisma } from '@codesheriff/db';
import { ScanStatus, ScanTrigger, Severity, FindingCategory } from '@codesheriff/shared';
import type { ScanJobPayload } from '@codesheriff/shared';
import type { Finding } from '@codesheriff/shared';
import { QUEUE_NAMES } from '@codesheriff/shared';
import { verifyRepoOwnership } from '../middleware/ownership.js';
import { App } from '@octokit/app';

const createScanSchema = z.object({
  repositoryId: z.string().cuid(),
  // commitSha is optional. When omitted, the API resolves the HEAD of the
  // specified branch via the GitHub App installation. PR webhooks still
  // pass an explicit SHA so historical/point-in-time scans remain possible.
  commitSha: z
    .string()
    .regex(/^[0-9a-fA-F]{40}$/, 'commitSha must be a 40-char hex SHA')
    .optional(),
  branch: z.string().min(1).max(255),
  prNumber: z.number().int().positive().optional(),
  prTitle: z.string().max(500).optional(),
});

const findingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).optional(),
  category: z
    .enum(['SECURITY', 'HALLUCINATION', 'AUTH', 'LOGIC', 'SECRET', 'QUALITY'])
    .optional(),
});

export async function scanRoutes(app: FastifyInstance): Promise<void> {
  const scanQueue = new Queue<ScanJobPayload>(QUEUE_NAMES.SCAN, {
    connection: (app as unknown as { redis: ConnectionOptions }).redis,
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/scans — list scans (optionally filtered by repositoryId)
  // ---------------------------------------------------------------------------
  const listScansQuerySchema = z.object({
    repositoryId: z.string().cuid().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });

  app.get(
    '/scans',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const parsed = listScansQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: 'Invalid query parameters',
        });
      }

      const { repositoryId, page, limit } = parsed.data;
      const offset = (page - 1) * limit;

      const where = {
        repository: { organizationId: req.dbUser!.organizationId },
        ...(repositoryId ? { repositoryId } : {}),
      };

      const [total, scans] = await Promise.all([
        prisma.scan.count({ where }),
        prisma.scan.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
          select: {
            id: true,
            status: true,
            riskScore: true,
            findingsCount: true,
            triggeredBy: true,
            branch: true,
            commitSha: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
            repository: { select: { id: true, name: true, fullName: true } },
          },
        }),
      ]);

      return reply.send({
        success: true,
        data: {
          scans: scans.map((s) => ({
            ...s,
            createdAt: s.createdAt.toISOString(),
            startedAt: s.startedAt?.toISOString() ?? null,
            completedAt: s.completedAt?.toISOString() ?? null,
            repositoryName: s.repository.name,
          })),
          total,
        },
        error: null,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // POST /api/v1/scans — trigger manual scan
  // ---------------------------------------------------------------------------
  app.post(
    '/scans',
    {
      preHandler: [app.authenticate],
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          // Stricter per-org limit for manual scan triggers
          keyGenerator: (req: Parameters<typeof app.authenticate>[0]) =>
            req.dbUser?.organizationId ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const parsed = createScanSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      const { repositoryId, branch, prNumber, prTitle } = parsed.data;

      // IDOR prevention: verify repository belongs to authenticated user's org
      const repo = await verifyRepoOwnership(req, reply, repositoryId);
      if (!repo) return; // verifyRepoOwnership already sent the response

      // Fetch repo details needed below (for SHA resolution and the worker payload)
      const repoDetails = await prisma.repository.findUnique({
        where: { id: repositoryId },
        select: {
          fullName: true,
          provider: true,
          organization: {
            select: { githubInstallationId: true },
          },
        },
      });

      if (!repoDetails) {
        return reply.status(500).send({
          success: false,
          data: null,
          error: 'Repository details could not be loaded',
        });
      }

      // Resolve the commit SHA. If the caller provided one we trust it (PR
      // webhooks pass the HEAD of the PR branch). Otherwise we ask GitHub
      // for the current HEAD of the requested branch so the worker clones
      // a real, point-in-time commit.
      let commitSha: string;
      if (parsed.data.commitSha) {
        commitSha = parsed.data.commitSha.toLowerCase();
      } else {
        const installationId = repoDetails.organization.githubInstallationId;
        if (!installationId) {
          return reply.status(400).send({
            success: false,
            data: null,
            error:
              'Cannot resolve branch HEAD: organization has no GitHub App installation linked.',
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

        const [owner, name] = repoDetails.fullName.split('/');
        if (!owner || !name) {
          return reply.status(500).send({
            success: false,
            data: null,
            error: `Malformed repository fullName: ${repoDetails.fullName}`,
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
          // Use the untyped request() — installation Octokit in this codebase
          // does not expose the .rest.* namespace (see orgs.ts for pattern).
          const { data: branchData } = await (octokit as unknown as {
            request: (route: string, params: Record<string, unknown>) => Promise<{
              data: { commit: { sha: string } };
            }>;
          }).request('GET /repos/{owner}/{repo}/branches/{branch}', {
            owner,
            repo: name,
            branch,
          });
          commitSha = branchData.commit.sha.toLowerCase();
        } catch (err) {
          req.log.error(
            { err, repositoryId, branch },
            'Failed to resolve branch HEAD via GitHub App'
          );
          return reply.status(502).send({
            success: false,
            data: null,
            error: `Could not resolve HEAD of branch "${branch}" on GitHub. Does the branch exist?`,
          });
        }
      }

      // Create scan record in QUEUED state
      const scan = await prisma.scan.create({
        data: {
          repositoryId,
          triggeredBy: ScanTrigger.MANUAL,
          prNumber: prNumber ?? null,
          prTitle: prTitle ?? null,
          branch,
          commitSha,
          status: ScanStatus.QUEUED,
        },
        select: { id: true, status: true },
      });

      // Enqueue the scan job — analysis is async
      const jobPayload: ScanJobPayload = {
        scanId: scan.id,
        repositoryId,
        repoFullName: repoDetails.fullName,
        provider: repoDetails.provider as ScanJobPayload['provider'],
        branch,
        commitSha,
        prNumber: prNumber ?? null,
        prTitle: prTitle ?? null,
        installationId: repoDetails.organization.githubInstallationId,
        enqueuedAt: new Date().toISOString(),
      };

      await scanQueue.add('scan', jobPayload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      });

      return reply.status(202).send({
        success: true,
        data: { scanId: scan.id, status: scan.status },
        error: null,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // GET /api/v1/scans/:id — get scan with paginated findings
  // ---------------------------------------------------------------------------
  app.get(
    '/scans/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const queryParsed = findingsQuerySchema.safeParse(req.query);
      if (!queryParsed.success) {
        return reply.status(400).send({
          success: false,
          data: null,
          error: 'Invalid query parameters',
        });
      }

      const { page, limit, severity, category } = queryParsed.data;
      const offset = (page - 1) * limit;

      // IDOR prevention: single query scoped to org from the verified JWT.
      // Collapses the former two-step (ownership check → unconstrained findUnique)
      // into one atomic findFirst to eliminate the TOCTOU window.
      const scan = await prisma.scan.findFirst({
        where: {
          id,
          repository: { organizationId: req.dbUser!.organizationId },
        },
        include: {
          repository: {
            select: { id: true, name: true, fullName: true, provider: true },
          },
        },
      });

      if (!scan) {
        return reply.status(404).send({
          success: false,
          data: null,
          error: 'Scan not found',
        });
      }

      // Ownership confirmed — fetch paginated findings in parallel
      const findingFilter = {
        scanId: id,
        ...(severity ? { severity } : {}),
        ...(category ? { category } : {}),
      };

      const [findingsCount, findings] = await Promise.all([
        prisma.finding.count({ where: findingFilter }),
        prisma.finding.findMany({
          where: findingFilter,
          orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
          skip: offset,
          take: limit,
        }),
      ]);

      return reply.send({
        success: true,
        data: { ...scan, findings },
        error: null,
        meta: {
          page,
          limit,
          total: findingsCount,
          totalPages: Math.ceil(findingsCount / limit),
        },
      });
    }
  );

  // ---------------------------------------------------------------------------
  // GET /api/v1/scans/:id/sarif — export scan as SARIF 2.1.0
  //
  // Returns a GitHub-compatible SARIF document that can be uploaded directly
  // to the GitHub code scanning API via:
  //   POST /repos/{owner}/{repo}/code-scanning/sarifs
  //
  // The full (unpaginated) findings list is exported — SARIF consumers expect
  // a complete result set. The response carries Content-Disposition so browsers
  // download the file rather than rendering it inline.
  // ---------------------------------------------------------------------------
  app.get(
    '/scans/:id/sarif',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      // SARIF export is a TEAM+ feature
      const orgForPlan = await prisma.organization.findUnique({
        where: { id: req.dbUser!.organizationId },
        select: { plan: true },
      });
      if (orgForPlan?.plan === 'FREE') {
        return reply.status(403).send({
          success: false,
          data: null,
          error: 'SARIF export requires the Team plan. Upgrade at Settings > Plan & Billing.',
        });
      }

      // IDOR prevention: org-scoped lookup (same pattern as GET /scans/:id)
      const scan = await prisma.scan.findFirst({
        where: {
          id,
          repository: { organizationId: req.dbUser!.organizationId },
        },
        include: {
          repository: {
            select: { id: true, name: true, fullName: true, provider: true },
          },
        },
      });

      if (!scan) {
        return reply.status(404).send({
          success: false,
          data: null,
          error: 'Scan not found',
        });
      }

      // Fetch ALL findings for this scan — SARIF is an untruncated export.
      // Suppressed and false-positive findings are still exported (annotated
      // via properties) so the consumer can decide how to handle them.
      const findings = await prisma.finding.findMany({
        where: { scanId: id },
        orderBy: [{ severity: 'asc' }, { filePath: 'asc' }, { lineStart: 'asc' }],
      });

      const sarif = buildSarif(scan, findings as Finding[]);

      return reply
        .status(200)
        .header('Content-Type', 'application/json')
        .header(
          'Content-Disposition',
          `attachment; filename="codesheriff-scan-${id}.sarif"`
        )
        .send(sarif);
    }
  );
}

// ---------------------------------------------------------------------------
// SARIF 2.1.0 builder
// ---------------------------------------------------------------------------

/** SARIF notification level mapped from CodeSheriff Severity */
function toSarifLevel(severity: string): 'error' | 'warning' | 'note' | 'none' {
  switch (severity) {
    case Severity.CRITICAL:
    case Severity.HIGH:
      return 'error';
    case Severity.MEDIUM:
      return 'warning';
    case Severity.LOW:
      return 'note';
    default:
      return 'none';
  }
}

/** SARIF property tags mapped from CodeSheriff FindingCategory */
function toSarifTags(category: string): string[] {
  switch (category) {
    case FindingCategory.SECURITY:
      return ['security'];
    case FindingCategory.SECRET:
      return ['security', 'secret-detection'];
    case FindingCategory.AUTH:
      return ['security', 'correctness'];
    case FindingCategory.LOGIC:
      return ['correctness'];
    case FindingCategory.HALLUCINATION:
      return ['maintainability', 'ai-specific'];
    case FindingCategory.QUALITY:
      return ['maintainability'];
    default:
      return [];
  }
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  defaultConfiguration: { level: 'error' | 'warning' | 'note' | 'none' };
  properties: { tags: string[]; category: string; precision: string };
  helpUri?: string;
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note' | 'none';
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string; uriBaseId: string };
      region: { startLine: number; endLine: number };
    };
  }>;
  partialFingerprints?: Record<string, string>;
  properties?: Record<string, unknown>;
}

/**
 * Builds a SARIF 2.1.0 document from a scan and its findings.
 *
 * Rule deduplication: each unique ruleId appears once in `driver.rules`
 * even if multiple findings reference the same rule.
 */
function buildSarif(
  scan: {
    id: string;
    branch: string;
    commitSha: string;
    repository: { fullName: string; provider: string };
  },
  findings: Finding[]
): object {
  // Build deduplicated rules index (keyed by ruleId)
  const rulesMap = new Map<string, SarifRule>();

  for (const f of findings) {
    const ruleId = f.ruleId ?? `codesheriff/${f.category.toLowerCase()}/${f.id}`;
    if (!rulesMap.has(ruleId)) {
      rulesMap.set(ruleId, {
        id: ruleId,
        name: toSarifRuleName(f.title),
        shortDescription: { text: f.title },
        fullDescription: { text: f.description },
        defaultConfiguration: { level: toSarifLevel(f.severity) },
        properties: {
          tags: toSarifTags(f.category),
          category: f.category,
          precision: f.isAIPatternSpecific ? 'medium' : 'high',
        },
      });
    }
  }

  const results: SarifResult[] = findings.map((f) => {
    const ruleId = f.ruleId ?? `codesheriff/${f.category.toLowerCase()}/${f.id}`;

    // Normalise file path: strip leading "./" or "/" so SARIF URIs are relative
    const uri = f.filePath.replace(/^\.?\//, '');

    const result: SarifResult = {
      ruleId,
      level: toSarifLevel(f.severity),
      message: { text: f.explanation ?? f.description },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri, uriBaseId: '%SRCROOT%' },
            region: {
              startLine: Math.max(1, f.lineStart),
              endLine: Math.max(1, f.lineEnd),
            },
          },
        },
      ],
      // Stable fingerprint so GitHub de-dups across repeated uploads
      partialFingerprints: {
        'primaryLocationLineHash/v1': `${f.filePath}:${f.lineStart}:${ruleId}`,
      },
      properties: {
        severity: f.severity,
        category: f.category,
        isAIPatternSpecific: f.isAIPatternSpecific,
        ...(f.falsePositive ? { 'problem.severity': 'false-positive' } : {}),
        ...(f.suppressed ? { suppressed: true } : {}),
        ...(f.remediation ? { remediation: f.remediation } : {}),
      },
    };

    return result;
  });

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'CodeSheriff',
            version: '1.0.0',
            informationUri: 'https://codesheriff.dev',
            rules: Array.from(rulesMap.values()),
          },
        },
        versionControlProvenance: [
          {
            repositoryUri: `https://github.com/${scan.repository.fullName}`,
            revisionId: scan.commitSha,
            branch: scan.branch,
          },
        ],
        results,
        // Artifacts section: unique file paths referenced in results
        artifacts: [...new Set(findings.map((f) => f.filePath.replace(/^\.?\//, '')))].map(
          (uri) => ({
            location: { uri, uriBaseId: '%SRCROOT%' },
          })
        ),
        properties: {
          scanId: scan.id,
          generatedAt: new Date().toISOString(),
          generator: 'CodeSheriff SARIF Exporter v1',
        },
      },
    ],
  };
}

/**
 * Converts a human-readable finding title to a camelCase SARIF rule name.
 * e.g. "Hardcoded API Key" → "HardcodedApiKey"
 */
function toSarifRuleName(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}
