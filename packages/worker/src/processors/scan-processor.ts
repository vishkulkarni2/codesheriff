/**
 * Scan Processor — BullMQ job handler
 *
 * Orchestrates the full scan lifecycle:
 *   1. Fetch changed files from VCS API
 *   2. Parse dependencies from manifest files
 *   3. Run the analysis pipeline
 *   4. Persist findings to database
 *   5. Update scan status + risk score
 *   6. Update RiskHistory snapshot
 *   7. Post GitHub Check Run result
 *   8. Post inline review comments (HIGH+ findings on PRs)
 *   9. Post PR summary comment
 *  10. Send Slack notification (if org has webhook configured)
 *
 * SECURITY:
 *   - VCS tokens obtained via installation token exchange (short-lived)
 *   - Dependencies parsed from repo files, not from user input
 *   - Findings are sanitized before DB writes
 */

import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { readdirSync, existsSync } from 'node:fs';
import { prisma } from '@codesheriff/db';
import { ScanStatus, Provider, Severity, PIPELINE_DEFAULTS } from '@codesheriff/shared';
import type { ScanJobPayload, AnalysisContext, AnalysisFeatureFlags } from '@codesheriff/shared';
import { AnalysisPipeline } from '@codesheriff/analyzer';
import { Redis } from 'ioredis';
import { GitHubClient } from '../services/github-client.js';
import { GitLabClient } from '../services/gitlab-client.js';
import { decryptToken } from '../services/token-crypto.js';
import { buildPRSummaryComment, buildInlineComment } from '../services/pr-comment.js';
import { sendSlackNotification } from '../services/slack-notifier.js';
import { logger } from '../utils/logger.js';

function listRulesDir(): { path: string; files: string[] } | null {
  for (const path of ['/app/rules', process.cwd() + '/rules']) {
    if (existsSync(path)) {
      try {
        return { path, files: readdirSync(path).sort() };
      } catch { /* ignore */ }
    }
  }
  return null;
}

interface ScanProcessorDeps {
  redis: Redis;
  githubClient: GitHubClient;
  gitlabClient: GitLabClient;
}

/**
 * Process a single scan job.
 * Called by BullMQ worker for each dequeued job.
 */
export async function processScanJob(
  job: Job<ScanJobPayload>,
  deps: ScanProcessorDeps
): Promise<void> {
  const { data: payload } = job;
  const log = logger.child({ scanId: payload.scanId, jobId: job.id });

  log.info('scan job started');

  // Mark scan as running
  await prisma.scan.update({
    where: { id: payload.scanId },
    data: { status: ScanStatus.RUNNING, startedAt: new Date() },
  });

  // Post GitHub Check Run as in_progress (non-fatal if it fails)
  let checkRunId: number | null = null;
  if (payload.provider === Provider.GITHUB && payload.installationId && payload.prNumber) {
    try {
      const [owner, repo] = splitFullName(payload.repoFullName);
      checkRunId = await deps.githubClient.createCheckRun(
        payload.installationId,
        owner,
        repo,
        payload.commitSha,
        'CodeSheriff',
        'in_progress'
      );
    } catch (err) {
      log.warn({ err }, 'failed to create GitHub Check Run — continuing scan');
    }
  }

  try {
    // ----- Step 1: Fetch files from VCS -----
    const files = await fetchFiles(payload, deps, log);
    log.info({ fileCount: files.length }, 'files fetched');

    if (files.length === 0) {
      log.warn('no files to scan — completing with empty results');
      await completeScan(payload.scanId, 0, [], 0);
      return;
    }

    // ----- Step 2: Parse dependencies -----
    const dependencies = parseDependencies(files);

    // ----- Step 3: Load org feature flags -----
    const repo = await prisma.repository.findUnique({
      where: { id: payload.repositoryId },
      select: {
        organization: {
          select: {
            plan: true,
            rules: {
              where: { isEnabled: true, isAISpecific: false },
              select: { semgrepPattern: true },
            },
          },
        },
      },
    });

    // Guard: repository may have been deleted between job enqueue and processing
    if (!repo) {
      log.warn({ repositoryId: payload.repositoryId }, 'repository not found — aborting scan');
      await prisma.scan.update({
        where: { id: payload.scanId },
        data: { status: ScanStatus.FAILED, completedAt: new Date() },
      });
      return;
    }

    const features = buildFeatureFlags(repo.organization.plan);

    // ----- Step 4: Build custom rules YAML -----
    const customRuleYaml =
      repo.organization.rules.map((r) => r.semgrepPattern).join('\n---\n') || undefined;

    // ----- Step 5: Run analysis pipeline -----
    const pipeline = new AnalysisPipeline({
      anthropicApiKey: process.env['ANTHROPIC_API_KEY']!,
      redis: deps.redis,
      ...(customRuleYaml !== undefined ? { customRuleYaml } : {}),
    });

    const ctx: AnalysisContext = {
      scanId: payload.scanId,
      repositoryId: payload.repositoryId,
      repoFullName: payload.repoFullName,
      provider: payload.provider as unknown as AnalysisContext['provider'],
      branch: payload.branch,
      commitSha: payload.commitSha,
      prNumber: payload.prNumber,
      files,
      dependencies,
      features,
    };

    const result = await pipeline.run(ctx);

    // ----- DIAGNOSTIC: log + stash detector timings/errors in Redis so we
    //           can inspect scan internals without Render log access.
    const diagnostic = {
      scanId: payload.scanId,
      fileCount: files.length,
      sampleFilePaths: files.slice(0, 5).map((f) => f.path),
      rulesDir: listRulesDir(),
      semgrepRulesDirEnv: process.env['SEMGREP_RULES_DIR'] ?? null,
      detectorTimings: result.detectorTimings,
      detectorErrors: result.errors.map((e) => ({
        detector: e.detector,
        message: e.message.slice(0, 500),
      })),
      rawFindingsCount: result.findings.length,
      rawFindingDetectors: result.findings.reduce<Record<string, number>>((acc, f) => {
        acc[f.detector] = (acc[f.detector] ?? 0) + 1;
        return acc;
      }, {}),
      rawFindingsSample: result.findings.slice(0, 20).map((f) => ({
        detector: f.detector,
        severity: f.severity,
        ruleId: f.ruleId,
        title: f.title.slice(0, 120),
        filePath: f.filePath,
        lineStart: f.lineStart,
      })),
      timestamp: new Date().toISOString(),
    };
    log.info(diagnostic, 'scan diagnostic summary');
    try {
      await deps.redis.setex(
        `scan_diagnostic:${payload.scanId}`,
        3600,
        JSON.stringify(diagnostic),
      );
      await deps.redis.setex('scan_diagnostic:last', 3600, JSON.stringify(diagnostic));
    } catch (err) {
      log.warn({ err }, 'failed to write scan diagnostic to redis');
    }

    // ----- Step 6: Persist findings -----
    log.info({ count: result.findings.length }, 'persisting findings');

    // Validate ruleIds against the Rule table — detectors may emit ruleIds
    // for built-in rules that aren't necessarily seeded in every environment.
    // Any unknown ruleId is coerced to null to avoid FK constraint failures.
    const referencedRuleIds = Array.from(
      new Set(result.findings.map((f) => f.ruleId).filter((id): id is string => !!id))
    );
    const existingRules = referencedRuleIds.length
      ? await prisma.rule.findMany({
          where: { id: { in: referencedRuleIds } },
          select: { id: true },
        })
      : [];
    const validRuleIds = new Set(existingRules.map((r) => r.id));

    // Write findings in batches to avoid hitting Postgres's parameter limit
    const BATCH_SIZE = 100;
    for (let i = 0; i < result.findings.length; i += BATCH_SIZE) {
      const batch = result.findings.slice(i, i + BATCH_SIZE);
      await prisma.finding.createMany({
        data: batch.map((f) => ({
          scanId: payload.scanId,
          repositoryId: payload.repositoryId,
          ruleId: f.ruleId && validRuleIds.has(f.ruleId) ? f.ruleId : null,
          title: f.title.slice(0, 500),
          description: f.description.slice(0, 2000),
          explanation: (f as typeof f & { explanation?: string }).explanation?.slice(0, 5000) ?? null,
          remediation: (f as typeof f & { remediation?: string }).remediation?.slice(0, 5000) ?? null,
          severity: f.severity,
          category: f.category,
          filePath: f.filePath.slice(0, 1000),
          lineStart: f.lineStart,
          lineEnd: f.lineEnd,
          codeSnippet: f.codeSnippet.slice(0, 2000),
          isAIPatternSpecific: f.isAIPatternSpecific,
          falsePositive: false,
          suppressed: false,
          suggestedFix: (f as typeof f & { autoFix?: { suggestedCode: string } }).autoFix?.suggestedCode?.slice(0, 5000) ?? null,
          fixConfidence: (f as typeof f & { autoFix?: { confidence: number } }).autoFix?.confidence ?? null,
        })),
        skipDuplicates: true,
      });
    }

    // ----- Step 7: Complete the scan record -----
    const criticalCount = result.findings.filter((f) => f.severity === Severity.CRITICAL).length;
    const highCount = result.findings.filter((f) => f.severity === Severity.HIGH).length;
    const mediumCount = result.findings.filter((f) => f.severity === Severity.MEDIUM).length;
    const lowCount = result.findings.filter((f) => f.severity === Severity.LOW).length;

    await completeScan(
      payload.scanId,
      result.riskScore,
      result.findings,
      result.durationMs,
    );

    // ----- Step 8: Update repository risk score -----
    await prisma.repository.update({
      where: { id: payload.repositoryId },
      data: { riskScore: result.riskScore, lastScannedAt: new Date() },
    });

    // ----- Step 9: Upsert risk history snapshot -----
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.riskHistory.upsert({
      where: { repositoryId_date: { repositoryId: payload.repositoryId, date: today } },
      update: { riskScore: result.riskScore, criticalCount, highCount, mediumCount, lowCount },
      create: {
        repositoryId: payload.repositoryId,
        date: today,
        riskScore: result.riskScore,
        criticalCount,
        highCount,
        mediumCount,
        lowCount,
      },
    });

    // ----- Step 10: GitHub integrations (non-fatal) -----
    if (payload.provider === Provider.GITHUB && payload.installationId) {
      await postGithubResults(payload, result.findings, result.riskScore, deps.githubClient, checkRunId, log);
    }

    // ----- Step 11: Slack notification (non-fatal) -----
    await postSlackNotification({
      payload,
      outcome: 'complete',
      riskScore: result.riskScore,
      criticalCount: result.findings.filter((f) => f.severity === Severity.CRITICAL).length,
      highCount: result.findings.filter((f) => f.severity === Severity.HIGH).length,
      mediumCount: result.findings.filter((f) => f.severity === Severity.MEDIUM).length,
      lowCount: result.findings.filter((f) => f.severity === Severity.LOW).length,
      log,
    });

    log.info(
      { riskScore: result.riskScore, findings: result.findings.length, durationMs: result.durationMs },
      'scan job complete'
    );
  } catch (err) {
    log.error({ err }, 'scan job failed');

    await prisma.scan.update({
      where: { id: payload.scanId },
      data: {
        status: ScanStatus.FAILED,
        completedAt: new Date(),
      },
    });

    // Send Slack failure notification (non-fatal)
    await postSlackNotification({
      payload,
      outcome: 'failed',
      riskScore: null,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      log,
    });

    // Update GitHub Check Run to failed state
    if (checkRunId !== null && payload.installationId) {
      try {
        const [owner, repo] = splitFullName(payload.repoFullName);
        await deps.githubClient.createCheckRun(
          payload.installationId,
          owner,
          repo,
          payload.commitSha,
          'CodeSheriff',
          'completed',
          'neutral',
          { title: 'Scan failed', summary: 'CodeSheriff encountered an error. Check logs.' }
        );
      } catch (checkErr) {
        log.warn({ checkErr }, 'failed to update Check Run to failed state');
      }
    }

    // Re-throw so BullMQ marks the job as failed and handles retries
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

async function fetchFiles(
  payload: ScanJobPayload,
  deps: ScanProcessorDeps,
  log: Logger
) {
  const maxFiles = parseInt(process.env['MAX_FILES_PER_SCAN'] ?? '50', 10);

  // ---- GitHub ----
  if (payload.provider === Provider.GITHUB) {
    if (!payload.installationId) {
      log.warn('GitHub scan missing installationId — cannot fetch files');
      return [];
    }

    const [owner, repo] = splitFullName(payload.repoFullName);

    if (payload.prNumber !== null) {
      return deps.githubClient.getPRFiles(
        payload.installationId,
        owner,
        repo,
        payload.prNumber,
        maxFiles
      );
    } else {
      // Manual / branch scan: walk the FULL repo tree at this commit, not the
      // diff against a parent. Push events used to call getPushFiles which
      // only returns files changed in the head commit, so manual scans on
      // long-lived branches were silently scanning ~zero files.
      log.info({ owner, repo, commitSha: payload.commitSha }, 'manual scan: fetching full branch tree');
      return deps.githubClient.getBranchTreeFiles(
        payload.installationId,
        owner,
        repo,
        payload.commitSha,
        maxFiles
      );
    }
  }

  // ---- GitLab ----
  if (payload.provider === Provider.GITLAB) {
    // Fetch the encrypted token for this org from VcsInstallation
    const repo = await prisma.repository.findUnique({
      where: { id: payload.repositoryId },
      select: { organizationId: true },
    });

    if (!repo) {
      log.warn('GitLab scan: repository not found, cannot look up VCS token');
      return [];
    }

    const vcs = await prisma.vcsInstallation.findUnique({
      where: {
        organizationId_provider: {
          organizationId: repo.organizationId,
          provider: Provider.GITLAB,
        },
      },
      select: { encryptedToken: true },
    });

    if (!vcs) {
      log.warn(
        { organizationId: repo.organizationId },
        'GitLab VCS token not configured for this org — cannot fetch files. ' +
        'Add a token at Settings → VCS Connections.'
      );
      return [];
    }

    let token: string;
    try {
      token = decryptToken(vcs.encryptedToken);
    } catch (err) {
      log.error({ err }, 'GitLab token decryption failed — key rotation may be needed');
      return [];
    }

    if (payload.prNumber !== null) {
      return deps.gitlabClient.getMRFiles(
        token,
        payload.repoFullName,
        payload.prNumber,
        payload.commitSha,
        maxFiles
      );
    } else {
      return deps.gitlabClient.getPushFiles(
        token,
        payload.repoFullName,
        payload.commitSha,
        maxFiles
      );
    }
  }

  // Bitbucket — not yet implemented
  log.warn({ provider: payload.provider }, 'VCS provider not yet supported for file fetch');
  return [];
}

/**
 * Parse dependencies from package.json or requirements.txt files.
 * Used by the HallucinationDetector to identify valid API surfaces.
 */
function parseDependencies(
  files: { path: string; content: string }[]
): Record<string, string> {
  const packageJson = files.find((f) => f.path === 'package.json' || f.path.endsWith('/package.json'));
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
    } catch {
      return {};
    }
  }

  const requirements = files.find((f) => f.path === 'requirements.txt');
  if (requirements) {
    const deps: Record<string, string> = {};
    for (const line of requirements.content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)([=~<>!]+(.*))?$/);
      if (match?.[1]) deps[match[1]] = match[3] ?? '*';
    }
    return deps;
  }

  return {};
}

function buildFeatureFlags(plan: string): AnalysisFeatureFlags {
  // LLM-powered detectors are gated by plan tier — FREE tier normally uses
  // static analysis only to control Anthropic API costs. The env flags can
  // FORCE-enable detectors even on FREE plans (used in staging/dogfood).
  const isFree = plan === 'FREE';
  const forceLlm = process.env['FORCE_LLM_DETECTORS'] === 'true';
  const llmEligible = !isFree || forceLlm;

  return {
    // LLM detectors: disabled on FREE tier unless overridden by env flag
    enableHallucinationDetection:
      llmEligible && process.env['ENABLE_HALLUCINATION_DETECTION'] !== 'false',
    enableAuthValidation:
      llmEligible && process.env['ENABLE_AUTH_VALIDATION'] !== 'false',
    enableLogicBugDetection:
      llmEligible && process.env['ENABLE_LOGIC_BUG_DETECTION'] !== 'false',
    // Auto-fix: LLM cost — disabled on FREE tier, can be overridden via env flag
    enableAutoFix: llmEligible && process.env['ENABLE_AUTO_FIX'] !== 'false',
    // Semgrep + TruffleHog run on all plans
    enableSecretsScanning: true,
    enableStaticAnalysis: true,
    // FREE plan gets a smaller file cap to limit resource usage
    maxFilesPerScan: isFree
      ? Math.min(parseInt(process.env['MAX_FILES_PER_SCAN'] ?? '50', 10), 20)
      : parseInt(process.env['MAX_FILES_PER_SCAN'] ?? '50', 10),
    maxLinesPerFile: parseInt(process.env['MAX_LINES_PER_FILE'] ?? '1000', 10),
  };
}

async function completeScan(
  scanId: string,
  riskScore: number,
  findings: { severity: Severity }[],
  durationMs: number
): Promise<void> {
  await prisma.scan.update({
    where: { id: scanId },
    data: {
      status: ScanStatus.COMPLETE,
      riskScore,
      findingsCount: findings.length,
      criticalCount: findings.filter((f) => f.severity === Severity.CRITICAL).length,
      highCount: findings.filter((f) => f.severity === Severity.HIGH).length,
      mediumCount: findings.filter((f) => f.severity === Severity.MEDIUM).length,
      lowCount: findings.filter((f) => f.severity === Severity.LOW).length,
      durationMs,
      completedAt: new Date(),
    },
  });
}

async function postGithubResults(
  payload: ScanJobPayload,
  findings: { severity: Severity; filePath: string; lineStart: number; title: string }[],
  riskScore: number,
  githubClient: GitHubClient,
  checkRunId: number | null,
  log: Logger
): Promise<void> {
  if (!payload.installationId) return;

  const [owner, repo] = splitFullName(payload.repoFullName);
  const apiUrl = process.env['FRONTEND_URL'] ?? 'https://codesheriff.dev';

  // Update Check Run to completed
  if (checkRunId !== null) {
    try {
      const hasCritical = findings.some((f) => f.severity === Severity.CRITICAL || f.severity === Severity.HIGH);
      await githubClient.createCheckRun(
        payload.installationId,
        owner,
        repo,
        payload.commitSha,
        'CodeSheriff',
        'completed',
        hasCritical ? 'failure' : 'success',
        {
          title: `Risk Score: ${riskScore}/100`,
          summary: `CodeSheriff found ${findings.length} issue(s). ${hasCritical ? 'Critical issues require attention.' : 'No critical issues found.'}`,
        }
      );
    } catch (err) {
      log.warn({ err }, 'failed to update Check Run');
    }
  }

  // Post PR comment and inline comments (only for PRs)
  if (payload.prNumber === null) return;

  try {
    const comment = buildPRSummaryComment({
      riskScore,
      scanId: payload.scanId,
      findings: findings as Parameters<typeof buildPRSummaryComment>[0]['findings'],
      apiUrl,
      repoFullName: payload.repoFullName,
    });

    await githubClient.postPRComment(
      payload.installationId,
      owner,
      repo,
      payload.prNumber,
      comment
    );
  } catch (err) {
    log.warn({ err }, 'failed to post PR summary comment');
  }

  // Post inline comments for HIGH+ findings (cap at 10 to avoid spam)
  const inlineFindings = findings
    .filter((f) => f.severity === Severity.CRITICAL || f.severity === Severity.HIGH)
    .slice(0, 10);

  for (const finding of inlineFindings) {
    try {
      const body = buildInlineComment(finding as Parameters<typeof buildInlineComment>[0]);
      await githubClient.postInlineComment(
        payload.installationId,
        owner,
        repo,
        payload.prNumber,
        payload.commitSha,
        finding.filePath,
        finding.lineStart,
        body
      );
    } catch (err) {
      log.warn({ err, path: finding.filePath }, 'failed to post inline comment');
    }
  }
}

/**
 * Looks up the org's Slack webhook URL and fires a notification.
 * All errors are caught and logged — never throws.
 */
async function postSlackNotification({
  payload,
  outcome,
  riskScore,
  criticalCount,
  highCount,
  mediumCount,
  lowCount,
  log,
}: {
  payload: ScanJobPayload;
  outcome: 'complete' | 'failed';
  riskScore: number | null;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  log: Logger;
}): Promise<void> {
  try {
    // Fetch the org's webhook URL via the repository relation
    const repo = await prisma.repository.findUnique({
      where: { id: payload.repositoryId },
      select: { organization: { select: { slackWebhookUrl: true } } },
    });

    const webhookUrl = repo?.organization?.slackWebhookUrl;
    if (!webhookUrl) return; // Slack not configured for this org — silently skip

    await sendSlackNotification({
      webhookUrl,
      scanId: payload.scanId,
      outcome,
      repoFullName: payload.repoFullName,
      branch: payload.branch,
      commitSha: payload.commitSha,
      riskScore,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      prNumber: payload.prNumber,
      prTitle: payload.prTitle,
      frontendUrl: process.env['FRONTEND_URL'] ?? 'https://codesheriff.dev',
    });

    log.info({ outcome }, 'slack notification sent');
  } catch (err) {
    // Non-fatal — log and continue
    log.warn({ err }, 'failed to send slack notification');
  }
}

function splitFullName(fullName: string): [string, string] {
  // Validate format before splitting — prevents path traversal via crafted fullName
  const VALID_FULLNAME = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
  if (!VALID_FULLNAME.test(fullName)) {
    throw new Error(`Invalid or unsafe repo fullName: ${fullName}`);
  }
  const slash = fullName.indexOf('/');
  const owner = fullName.slice(0, slash);
  const repo = fullName.slice(slash + 1);
  return [owner, repo];
}
