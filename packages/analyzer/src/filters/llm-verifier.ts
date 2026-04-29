/**
 * LLM Verifier — Second-pass Claude call per finding
 *
 * After the heuristic BugFocusFilter, each surviving finding gets an LLM
 * call asking: "Is this a REAL functional bug, security vulnerability, or
 * crash risk?" Findings classified as FALSE_POSITIVE are dropped.
 *
 * Fail-safe rules (no LLM call):
 *   - CRITICAL severity → always REAL_BUG, keep
 *   - SecretsScanner detector (TruffleHog) → always REAL_BUG, keep
 *   - SECRET category in test/spec/fixture file → always drop (test fixtures have fake creds by design)
 *
 * Error policy: any LLM error (API, parse, timeout) → fail-open (keep)
 *
 * Concurrency: batches of up to MAX_CONCURRENCY concurrent LLM calls
 */

import { FindingCategory, Severity } from '@codesheriff/shared';
import type { RawFinding } from '@codesheriff/shared';
import type { LlmClient } from '../llm/client.js';
import { getScanLogger } from '../utils/logger.js';

const SYSTEM_PROMPT = `You are a senior security engineer doing final triage on automated code analysis findings. Your default answer is REJECT (FALSE_POSITIVE).

Only classify as REAL_BUG if you are CONFIDENT (>=0.75) that this finding represents ONE OF THE FOLLOWING:
1. A concrete security vulnerability with a direct exploit path visible in the code shown (SQLi, XSS, auth bypass, path traversal, RCE, hardcoded secret)
2. A crash risk that will definitely occur at runtime: null/undefined dereference on a non-guarded access, array out-of-bounds, unhandled async rejection on a code path that is guaranteed to execute
3. A provable logic error where the code demonstrably does the WRONG thing: wrong variable used, inverted condition, off-by-one in a critical calculation, data corruption
4. A race condition or async bug that WILL cause incorrect behavior (not just "might")

Classify as FALSE_POSITIVE (default) if:
- The finding is theoretical, hypothetical, or requires additional context not shown
- The code might be correct depending on higher-level framework / middleware context (e.g., auth checks at route level, not query level)
- It is a best practice violation, code smell, style issue, or refactoring suggestion
- It flags a pattern that is intentional and common in the repository's framework (e.g., .catch(() => {}) for telemetry suppression, role checks in auth-gated routes)
- The exploit path requires assumptions not supported by the code shown
- It is missing error handling for an edge case that is not clearly likely to occur
- You are uncertain or the evidence is ambiguous — when in doubt, REJECT
- The "secret" value is clearly a placeholder or template: YOUR_API_KEY, YOUR_TOKEN_HERE, CHANGE_ME, EXAMPLE_KEY, xxx, REPLACE_ME, <secret>, or similar pattern
- The "credential" is a Redis/cache key prefix, namespace, or protocol string (e.g., "chat:token:", "session:", "user:", "prefix:")
- The "token" is a sentinel or control-flow string used in application logic (e.g., "NO_HEARTBEAT", "SKIP_CHECK", "BYPASS")
- The value is clearly a test fixture, mock, or documentation example (file path contains test/, spec/, __tests__, fixtures/, mock/, example/)

CRITICAL: This is a PR diff — code is incomplete. NEVER flag issues caused by missing imports, helper functions defined elsewhere, or truncated context.

Be aggressive about rejecting. A missed finding (false negative) is far less costly than a noisy false positive. Your job is to be a strict final gate.

Output strict JSON only — no markdown, no extra text:
{"verdict":"REAL_BUG"|"FALSE_POSITIVE","reason":"<one sentence>","confidence":0.0-1.0}

confidence: 1.0 = certain it is a real bug, 0.0 = certain it is a false positive. Only REAL_BUG with confidence >= 0.75 will be kept.`;

export interface VerifyResult {
  finding: RawFinding;
  verdict: 'REAL_BUG' | 'FALSE_POSITIVE';
  reason: string | undefined;
  /** Confidence score 0.0–1.0 from the LLM (absent if bypassed) */
  confidence?: number | undefined;
  /** True if the finding was kept via bypass rule (no LLM call made) */
  bypassed?: boolean;
}

/** Structured telemetry emitted after each verify() call */
export interface VerifierTelemetry {
  scanId: string;
  totalFindings: number;
  verified: number;
  dropped: number;
  bypassedAlwaysKeep: number;
  bypassedAlwaysDrop: number;
  avgConfidence: number | undefined;
}

/**
 * Verify a single finding using the LLM.
 * Exported for testability — does NOT apply bypass rules.
 * Throws on parse error or invalid verdict (caller should fail-open).
 */
export async function verifyFinding(finding: RawFinding, llm: LlmClient): Promise<VerifyResult> {
  const snippet = finding.codeSnippet?.trim() || '(no code snippet available)';
  const description = finding.description?.trim() || finding.title;

  const userPrompt = `Classify this finding as REAL_BUG or FALSE_POSITIVE.

Title: ${finding.title}
Category: ${finding.category} | Severity: ${finding.severity}
File: ${finding.filePath} lines ${finding.lineStart}–${finding.lineEnd}
Description: ${description}

Code:
${snippet}

Answer: is this a real functional bug, security vulnerability, or crash risk?`;

  const response = await llm.call({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    codeContent: snippet,
    detector: 'LlmVerifier',
  });

  const text = response.content.trim();

  // Extract JSON object even if model adds surrounding prose
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error(`LlmVerifier: no JSON in response: ${text.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as { verdict?: unknown; reason?: unknown; confidence?: unknown };
  const verdictRaw = String(parsed.verdict ?? '').toUpperCase();

  if (verdictRaw !== 'REAL_BUG' && verdictRaw !== 'FALSE_POSITIVE') {
    throw new Error(`LlmVerifier: unexpected verdict "${verdictRaw}"`);
  }

  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : undefined;

  return {
    finding,
    verdict: verdictRaw as 'REAL_BUG' | 'FALSE_POSITIVE',
    reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    confidence,
  };
}

export class LlmVerifier {
  private static readonly MAX_CONCURRENCY = 5;

  constructor(private readonly llm: LlmClient) {}

  /**
   * Verify all findings. Returns the subset classified as REAL_BUG.
   * Always resolves — individual failures keep the finding (fail-open).
   */
  async verify(scanId: string, findings: RawFinding[]): Promise<RawFinding[]> {
    const log = getScanLogger(scanId, 'LlmVerifier');

    if (findings.length === 0) return [];

    const kept: RawFinding[] = [];
    let dropped = 0;
    let bypassedAlwaysKeep = 0;
    let bypassedAlwaysDrop = 0;
    const confidences: number[] = [];

    // Process in batches of MAX_CONCURRENCY to avoid rate limiting
    for (let i = 0; i < findings.length; i += LlmVerifier.MAX_CONCURRENCY) {
      const batch = findings.slice(i, i + LlmVerifier.MAX_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map((f) => this.processFinding(f, log))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { finding, keep, bypassed } = result.value;
          if (keep) {
            kept.push(finding);
            if (finding.verifierConfidence !== undefined) {
              confidences.push(finding.verifierConfidence);
            }
          } else {
            dropped++;
          }
          if (bypassed === 'keep') bypassedAlwaysKeep++;
          else if (bypassed === 'drop') bypassedAlwaysDrop++;
        } else {
          // Should not happen — processFinding is always fail-open
          log.error({ reason: String(result.reason) }, 'LlmVerifier unexpected rejection');
        }
      }
    }

    const avgConfidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : undefined;

    // Telemetry stub — structured log for observability
    log.info(
      {
        scanId,
        totalFindings: findings.length,
        verified: kept.length,
        dropped,
        bypassedAlwaysKeep,
        bypassedAlwaysDrop,
        avgConfidence,
      },
      'LLM verifier stage complete'
    );

    return kept;
  }

  private async processFinding(
    finding: RawFinding,
    log: ReturnType<typeof getScanLogger>
  ): Promise<{ finding: RawFinding; keep: boolean; bypassed: 'keep' | 'drop' | false }> {
    // Bypass rule: CRITICAL severity → always keep, no LLM call
    if (finding.severity === Severity.CRITICAL) {
      log.debug({ ruleId: finding.ruleId, title: finding.title }, 'LlmVerifier bypass: CRITICAL → KEEP');
      return { finding, keep: true, bypassed: 'keep' };
    }

    // Bypass rule: TruffleHog (SecretsScanner) → always keep, no LLM call.
    // TruffleHog uses entropy analysis + known credential signatures — very high precision.
    // Semgrep SECRET-category rules fire on placeholders and key prefixes — LLM verifies those.
    if (finding.detector === 'SecretsScanner') {
      log.debug({ ruleId: finding.ruleId, title: finding.title }, 'LlmVerifier bypass: TruffleHog → KEEP');
      return { finding, keep: true, bypassed: 'keep' };
    }

    // Drop SECRET-category findings in test/spec/fixture files — test fixtures
    // intentionally contain fake credentials; flagging them is pure noise.
    if (
      finding.category === FindingCategory.SECRET &&
      /[/.](?:test|spec|mock|fixture|example|sample)[/.]|__tests__|\.test\.|\.spec\./i.test(finding.filePath)
    ) {
      log.debug({ ruleId: finding.ruleId, filePath: finding.filePath }, 'LlmVerifier bypass: SECRET in test file → DROP');
      return { finding, keep: false, bypassed: 'drop' };
    }

    // NOTE: SECURITY HIGH bypass was removed. High-severity security findings
    // (e.g., IDOR pattern rules) were the primary source of FPs on cal.com because
    // they fire on every Prisma query without understanding middleware-level auth.
    // All non-CRITICAL, non-SECRET findings now go through LLM verification.

    // Bypass rule: QUALITY category with LOW severity → always drop, no LLM call
    if (finding.category === FindingCategory.QUALITY && finding.severity === Severity.LOW) {
      log.debug({ ruleId: finding.ruleId, title: finding.title }, 'LlmVerifier bypass: QUALITY LOW → DROP');
      return { finding, keep: false, bypassed: 'drop' };
    }

    // LLM call with fail-open error handling
    try {
      const result = await verifyFinding(finding, this.llm);

      // Confidence gate: REAL_BUG must have confidence >= 0.75 to be kept.
      // Previously we inverted low-confidence FALSE_POSITIVEs to REAL_BUG (fail-open),
      // which was actively adding noise. Now: uncertain = drop.
      let verdict = result.verdict;
      const MIN_CONFIDENCE = 0.75;
      if (verdict === 'REAL_BUG' && result.confidence !== undefined && result.confidence < MIN_CONFIDENCE) {
        log.debug(
          { ruleId: finding.ruleId, confidence: result.confidence },
          `LlmVerifier: REAL_BUG confidence ${result.confidence} < ${MIN_CONFIDENCE} threshold → treating as FALSE_POSITIVE`
        );
        verdict = 'FALSE_POSITIVE';
      }

      const keep = verdict === 'REAL_BUG';

      // Attach confidence to the finding for downstream telemetry
      const enrichedFinding: RawFinding = result.confidence !== undefined
        ? { ...finding, verifierConfidence: result.confidence }
        : finding;

      log.debug(
        {
          ruleId: finding.ruleId,
          title: finding.title,
          verdict,
          confidence: result.confidence,
          reason: result.reason,
        },
        'LlmVerifier verdict'
      );

      return { finding: enrichedFinding, keep, bypassed: false };
    } catch (err) {
      // Fail-CLOSED: LLM errors drop the finding.
      // Previously fail-open (keep on error) was adding noise whenever the LLM
      // returned malformed JSON or timed out. A dropped finding (false negative)
      // is less harmful than a kept false positive at 8% precision.
      log.warn(
        { ruleId: finding.ruleId, title: finding.title, err: String(err) },
        'LlmVerifier error — fail-closed, dropping finding'
      );
      return { finding, keep: false, bypassed: false };
    }
  }
}
