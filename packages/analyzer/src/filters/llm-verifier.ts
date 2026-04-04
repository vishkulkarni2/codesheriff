/**
 * LLM Verifier — Second-pass Claude call per finding
 *
 * After the heuristic BugFocusFilter, each surviving finding gets an LLM
 * call asking: "Is this a REAL functional bug, security vulnerability, or
 * crash risk?" Findings classified as FALSE_POSITIVE are dropped.
 *
 * Fail-safe rules (no LLM call):
 *   - CRITICAL severity → always REAL_BUG, keep
 *   - SecretsScanner detector → always REAL_BUG, keep
 *
 * Error policy: any LLM error (API, parse, timeout) → fail-open (keep)
 *
 * Concurrency: batches of up to MAX_CONCURRENCY concurrent LLM calls
 */

import { FindingCategory, Severity } from '@codesheriff/shared';
import type { RawFinding } from '@codesheriff/shared';
import type { LlmClient } from '../llm/client.js';
import { getScanLogger } from '../utils/logger.js';

const SYSTEM_PROMPT = `You are a senior security engineer doing final triage on automated code analysis findings.

Your task: classify each finding as REAL_BUG or FALSE_POSITIVE, and provide a confidence score.

REAL_BUG — keep if it is:
- A functional bug that causes incorrect behavior, wrong output, or data corruption in the code shown
- A security vulnerability with a concrete exploit path (SQLi, XSS, auth bypass, path traversal, injection)
- A crash risk: null dereference, unchecked array index, unhandled exception on a hot path
- A hardcoded secret, credential, or token
- A logic error where the code provably does the wrong thing (wrong variable, off-by-one, inverted condition)

FALSE_POSITIVE — drop if it is:
- A stylistic preference, naming convention, or formatting issue
- A suggestion to refactor or use a newer API when the existing code works correctly
- A theoretical risk with no practical exploit path given the context shown
- A performance optimization or memory efficiency suggestion
- Missing error handling for edge cases that are not plausible in context
- A concern about incomplete code fragments (missing imports, partial functions in a diff)
- A best practice suggestion that doesn't change correctness

IMPORTANT CONTEXT: You are analyzing code diffs from pull requests — the code may be incomplete. Do not flag issues that arise purely from missing context (e.g., imports not shown, helper functions defined elsewhere).

Output strict JSON only — no markdown, no extra text:
{"verdict":"REAL_BUG"|"FALSE_POSITIVE","reason":"<one sentence>","confidence":0.0-1.0}

confidence: 1.0 = certain, 0.5 = uncertain, 0.0 = completely guessing`;

export interface VerifyResult {
  finding: RawFinding;
  verdict: 'REAL_BUG' | 'FALSE_POSITIVE';
  reason: string | undefined;
  /** Confidence score 0.0–1.0 from the LLM (absent if bypassed) */
  confidence?: number | undefined;
  /** True if the finding was kept via bypass rule (no LLM call made) */
  bypassed?: boolean;
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

    // Bypass rule: SecretsScanner or SECRET category → always keep, no LLM call
    if (finding.detector === 'SecretsScanner' || finding.category === FindingCategory.SECRET) {
      log.debug({ ruleId: finding.ruleId, title: finding.title }, 'LlmVerifier bypass: SECRET → KEEP');
      return { finding, keep: true, bypassed: 'keep' };
    }

    // Bypass rule: SECURITY category with HIGH severity → always keep
    // (CRITICAL already handled above)
    if (finding.category === FindingCategory.SECURITY && finding.severity === Severity.HIGH) {
      log.debug({ ruleId: finding.ruleId, title: finding.title }, 'LlmVerifier bypass: SECURITY HIGH/CRITICAL → KEEP');
      return { finding, keep: true, bypassed: 'keep' };
    }

    // Bypass rule: QUALITY category with LOW severity → always drop, no LLM call
    if (finding.category === FindingCategory.QUALITY && finding.severity === Severity.LOW) {
      log.debug({ ruleId: finding.ruleId, title: finding.title }, 'LlmVerifier bypass: QUALITY LOW → DROP');
      return { finding, keep: false, bypassed: 'drop' };
    }

    // LLM call with fail-open error handling
    try {
      const result = await verifyFinding(finding, this.llm);

      // Confidence < 0.5 on FALSE_POSITIVE → uncertain, keep it (fail toward keeping)
      let verdict = result.verdict;
      if (verdict === 'FALSE_POSITIVE' && result.confidence !== undefined && result.confidence < 0.5) {
        log.debug(
          { ruleId: finding.ruleId, confidence: result.confidence },
          'LlmVerifier: low-confidence FALSE_POSITIVE → treating as REAL_BUG'
        );
        verdict = 'REAL_BUG';
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
      // Fail-open: any error keeps the finding
      log.warn(
        { ruleId: finding.ruleId, title: finding.title, err: String(err) },
        'LlmVerifier error — fail-open, keeping finding'
      );
      return { finding, keep: true, bypassed: false };
    }
  }
}
