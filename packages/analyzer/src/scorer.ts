/**
 * SeverityScorer
 *
 * Aggregates all raw findings into a normalized risk score (0–100).
 *
 * Scoring formula:
 *   raw = Σ(finding.weight) where weight is determined by severity
 *   score = min(100, floor(raw / normalizationFactor * 100))
 *
 * The normalization factor scales so that a typical "bad" PR (5 high + 2 critical)
 * produces a score around 75–85, without a single critical finding immediately
 * pinning everything to 100.
 */

import type { RawFinding } from '@codesheriff/shared';
import { Severity, SEVERITY_WEIGHTS, MAX_RISK_SCORE } from '@codesheriff/shared';

export interface ScorerResult {
  riskScore: number;
  findingsCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
}

/**
 * The raw weight sum that maps to a risk score of 100.
 * Calibrated so: 1 CRITICAL (40) + 3 HIGH (60) + 5 MEDIUM (40) = 140 ≈ score 100.
 */
const NORMALIZATION_FACTOR = 140;

/** Bonus multiplier applied when AI-pattern-specific findings exist */
const AI_PATTERN_BONUS = 1.1;

export class SeverityScorer {
  /**
   * Compute a 0–100 risk score from a set of raw findings.
   * False positives and suppressed findings are excluded from scoring.
   */
  score(findings: RawFinding[]): ScorerResult {
    // Exclude false positives and suppressed findings — they don't contribute to risk
    const active = findings.filter(
      (f) =>
        !(f as unknown as { falsePositive?: boolean }).falsePositive &&
        !(f as unknown as { suppressed?: boolean }).suppressed
    );

    let rawWeight = 0;
    let criticalCount = 0;
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;
    let infoCount = 0;
    let hasAIPatterns = false;

    for (const finding of active) {
      rawWeight += SEVERITY_WEIGHTS[finding.severity];

      switch (finding.severity) {
        case Severity.CRITICAL:
          criticalCount++;
          break;
        case Severity.HIGH:
          highCount++;
          break;
        case Severity.MEDIUM:
          mediumCount++;
          break;
        case Severity.LOW:
          lowCount++;
          break;
        case Severity.INFO:
          infoCount++;
          break;
      }

      if (finding.isAIPatternSpecific) hasAIPatterns = true;
    }

    // Apply AI pattern bonus — AI-generated vulnerabilities carry extra risk
    // because they tend to be more systematic (same bug copy-pasted everywhere)
    if (hasAIPatterns && rawWeight > 0) {
      rawWeight = Math.ceil(rawWeight * AI_PATTERN_BONUS);
    }

    const riskScore = Math.min(
      MAX_RISK_SCORE,
      Math.floor((rawWeight / NORMALIZATION_FACTOR) * MAX_RISK_SCORE)
    );

    return {
      riskScore,
      findingsCount: active.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      infoCount,
    };
  }
}
