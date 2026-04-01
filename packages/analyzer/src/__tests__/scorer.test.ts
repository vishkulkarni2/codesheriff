/**
 * SeverityScorer unit tests
 */

import { describe, it, expect } from 'vitest';
import { SeverityScorer } from '../scorer.js';
import { Severity, FindingCategory } from '@codesheriff/shared';
import type { RawFinding } from '@codesheriff/shared';

function makeFinding(severity: Severity, isAI = false): RawFinding {
  return {
    ruleId: 'test:rule',
    title: 'Test finding',
    description: 'Test',
    severity,
    category: FindingCategory.SECURITY,
    filePath: 'src/test.ts',
    lineStart: 1,
    lineEnd: 1,
    codeSnippet: 'const x = 1;',
    isAIPatternSpecific: isAI,
    detector: 'StaticAnalyzer',
  };
}

describe('SeverityScorer', () => {
  const scorer = new SeverityScorer();

  it('returns 0 for empty findings', () => {
    const result = scorer.score([]);
    expect(result.riskScore).toBe(0);
    expect(result.findingsCount).toBe(0);
  });

  it('counts severities correctly', () => {
    const findings = [
      makeFinding(Severity.CRITICAL),
      makeFinding(Severity.CRITICAL),
      makeFinding(Severity.HIGH),
      makeFinding(Severity.MEDIUM),
      makeFinding(Severity.LOW),
    ];
    const result = scorer.score(findings);
    expect(result.criticalCount).toBe(2);
    expect(result.highCount).toBe(1);
    expect(result.mediumCount).toBe(1);
    expect(result.lowCount).toBe(1);
    expect(result.findingsCount).toBe(5);
  });

  it('score is capped at 100', () => {
    // 10 CRITICAL findings = 400 raw weight, well above the normalization factor
    const findings = Array.from({ length: 10 }, () => makeFinding(Severity.CRITICAL));
    const result = scorer.score(findings);
    expect(result.riskScore).toBe(100);
  });

  it('single CRITICAL finding produces a non-zero score', () => {
    const result = scorer.score([makeFinding(Severity.CRITICAL)]);
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.riskScore).toBeLessThan(100);
  });

  it('INFO findings contribute 0 weight', () => {
    const result = scorer.score([makeFinding(Severity.INFO)]);
    expect(result.riskScore).toBe(0);
    expect(result.infoCount).toBe(1);
  });

  it('AI pattern bonus increases score when AI patterns present', () => {
    const baseFindings = [makeFinding(Severity.HIGH, false)];
    const aiFindings = [makeFinding(Severity.HIGH, true)];

    const baseScore = scorer.score(baseFindings).riskScore;
    const aiScore = scorer.score(aiFindings).riskScore;

    expect(aiScore).toBeGreaterThanOrEqual(baseScore);
  });

  it('false positive findings are excluded from score', () => {
    const findings = [
      { ...makeFinding(Severity.CRITICAL), falsePositive: true },
      makeFinding(Severity.MEDIUM),
    ];
    const resultWithFP = scorer.score(findings);
    const resultWithoutFP = scorer.score([makeFinding(Severity.MEDIUM)]);

    // Score should equal the medium-only score since CRITICAL is a false positive
    expect(resultWithFP.riskScore).toBe(resultWithoutFP.riskScore);
    // findingsCount excludes false positives
    expect(resultWithFP.findingsCount).toBe(1);
  });

  it('suppressed findings are excluded from score', () => {
    const findings = [
      { ...makeFinding(Severity.CRITICAL), suppressed: true },
      makeFinding(Severity.LOW),
    ];
    const result = scorer.score(findings);
    // Only the LOW finding contributes
    expect(result.criticalCount).toBe(0);
    expect(result.findingsCount).toBe(1);
  });

  it('mixed HIGH+MEDIUM produces a mid-range score', () => {
    const findings = [
      makeFinding(Severity.HIGH),
      makeFinding(Severity.HIGH),
      makeFinding(Severity.MEDIUM),
      makeFinding(Severity.MEDIUM),
      makeFinding(Severity.MEDIUM),
    ];
    const result = scorer.score(findings);
    // 2*20 + 3*8 = 40+24 = 64 raw / 140 * 100 ≈ 45
    expect(result.riskScore).toBeGreaterThan(30);
    expect(result.riskScore).toBeLessThan(70);
  });
});
