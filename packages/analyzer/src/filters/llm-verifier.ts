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

const SYSTEM_PROMPT = `You are a senior security engineer reviewing code analysis findings.

Classify each finding as REAL_BUG or FALSE_POSITIVE.

REAL_BUG: A functional bug causing incorrect behavior, a security vulnerability, or a crash risk. Examples:
- SQL injection, XSS, CSRF, path traversal, authentication bypass
- Null pointer dereference, race condition, resource leak
- Logic bug producing incorrect output or data corruption
- Hardcoded secret or credential

FALSE_POSITIVE: A stylistic preference, theoretical concern, best practice suggestion, or potential improvement. Examples:
- Code style, formatting, naming conventions
- Suggestion to use a newer API when the old one works correctly
- Theoretical risk with no practical exploit path in this context
- Performance optimization or refactoring suggestion
- Missing documentation or comments

Output strict JSON only — no markdown, no extra text:
{"verdict":"REAL_BUG"|"FALSE_POSITIVE","reason":"<one sentence>"}`;

export interface VerifyResult {
  finding: RawFinding;
  verdict: 'REAL_BUG' | 'FALSE_POSITIVE';
  reason: string | undefined;
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

  return {
    finding,
    verdict: verdictRaw as 'REAL_BUG' | 'FALSE_POSITIVE',
    reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
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

    // Process in batches of MAX_CONCURRENCY to avoid rate limiting
    for (let i = 0; i < findings.length; i += LlmVerifier.MAX_CONCURRENCY) {
      const batch = findings.slice(i, i + LlmVerifier.MAX_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map((f) => this.processFinding(f, log))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value.keep) {
            kept.push(result.value.finding);
          } else {
            dropped++;
          }
        } else {
          // Should not happen — processFinding is always fail-open
          log.error({ reason: String(result.reason) }, 'LlmVerifier unexpected rejection');
        }
      }
    }

    log.info(
      { total: findings.length, kept: kept.length, dropped },
      'LLM verifier stage complete'
    );

    return kept;
  }

  private async processFinding(
    finding: RawFinding,
    log: ReturnType<typeof getScanLogger>
  ): Promise<{ finding: RawFinding; keep: boolean }> {
    // Bypass rule: CRITICAL severity → always keep, no LLM call
    if (finding.severity === Severity.CRITICAL) {
      log.debug(
        { ruleId: finding.ruleId, title: finding.title },
        'LlmVerifier bypass: CRITICAL → KEEP'
      );
      return { finding, keep: true };
    }

    // Bypass rule: SecretsScanner → always keep, no LLM call
    if (finding.detector === 'SecretsScanner') {
      log.debug(
        { ruleId: finding.ruleId, title: finding.title },
        'LlmVerifier bypass: SecretsScanner → KEEP'
      );
      return { finding, keep: true };
    }

    // LLM call with fail-open error handling
    try {
      const result = await verifyFinding(finding, this.llm);
      const keep = result.verdict === 'REAL_BUG';

      log.debug(
        {
          ruleId: finding.ruleId,
          title: finding.title,
          verdict: result.verdict,
          reason: result.reason,
        },
        'LlmVerifier verdict'
      );

      return { finding, keep };
    } catch (err) {
      // Fail-open: any error keeps the finding
      log.warn(
        { ruleId: finding.ruleId, title: finding.title, err: String(err) },
        'LlmVerifier error — fail-open, keeping finding'
      );
      return { finding, keep: true };
    }
  }
}
