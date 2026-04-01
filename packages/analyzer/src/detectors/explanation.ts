/**
 * ExplanationEngine
 *
 * Enriches high-severity findings with AI-generated developer-friendly
 * explanations, impact statements, and copy-pasteable code fixes.
 *
 * Only explains CRITICAL and HIGH severity findings to control LLM spend.
 * Results are cached in Redis so repeated findings across scans only
 * incur one LLM call.
 */

import type { RawFinding, FindingExplanation } from '@codesheriff/shared';
import { Severity } from '@codesheriff/shared';
import type { LlmClient } from '../llm/client.js';
import { EXPLANATION_SYSTEM_PROMPT, buildExplanationPrompt } from '../llm/prompts.js';
import { getScanLogger } from '../utils/logger.js';

/** Only explain findings at or above this severity */
const MIN_SEVERITY_FOR_EXPLANATION = new Set([Severity.CRITICAL, Severity.HIGH]);

/** Maximum findings to explain per scan (cost control) */
const MAX_EXPLANATIONS_PER_SCAN = 20;

export class ExplanationEngine {
  constructor(private readonly llm: LlmClient) {}

  /**
   * Enrich findings with AI-generated explanations.
   * Mutates the findings array in-place, adding explanation and remediation.
   */
  async enrich(
    scanId: string,
    findings: RawFinding[],
    language: string
  ): Promise<void> {
    const log = getScanLogger(scanId, 'ExplanationEngine');

    const toExplain = findings
      .filter((f) => MIN_SEVERITY_FOR_EXPLANATION.has(f.severity))
      .slice(0, MAX_EXPLANATIONS_PER_SCAN);

    if (toExplain.length === 0) {
      log.debug('no findings require explanation');
      return;
    }

    log.debug({ count: toExplain.length }, 'enriching findings with explanations');

    // Process explanations sequentially to avoid hammering the LLM
    // The LlmClient handles caching so duplicates are cheap
    for (const finding of toExplain) {
      try {
        const explanation = await this.explain(finding, language);

        // Attach to the finding object — pipeline.ts persists these fields
        (finding as RawFinding & { explanation?: string; remediation?: string }).explanation =
          explanation.explanation + '\n\nImpact: ' + explanation.impact;
        (finding as RawFinding & { explanation?: string; remediation?: string }).remediation =
          explanation.fix + '\n\nReference: ' + explanation.reference;
      } catch (err) {
        // Non-fatal — finding persists without explanation
        log.error({ err, title: finding.title }, 'failed to explain finding');
      }
    }

    log.info(
      { explained: toExplain.length },
      'ExplanationEngine complete'
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async explain(
    finding: RawFinding,
    language: string
  ): Promise<FindingExplanation> {
    const prompt = buildExplanationPrompt({
      title: finding.title,
      description: finding.description,
      codeSnippet: finding.codeSnippet,
      language,
      severity: finding.severity,
      category: finding.category,
    });

    const response = await this.llm.call({
      systemPrompt: EXPLANATION_SYSTEM_PROMPT,
      userPrompt: prompt,
      codeContent: finding.codeSnippet,
      detector: 'ExplanationEngine',
    });

    return parseExplanationResponse(response.content);
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseExplanationResponse(content: string): FindingExplanation {
  const fallback: FindingExplanation = {
    explanation: 'This finding requires manual review.',
    impact: 'Potential security vulnerability.',
    fix: 'Review and remediate the flagged code.',
    reference: 'https://owasp.org/www-project-top-ten/',
  };

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!isExplanation(parsed)) return fallback;

    return parsed;
  } catch {
    return fallback;
  }
}

function isExplanation(v: unknown): v is FindingExplanation {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj['explanation'] === 'string' &&
    typeof obj['impact'] === 'string' &&
    typeof obj['fix'] === 'string' &&
    typeof obj['reference'] === 'string'
  );
}
