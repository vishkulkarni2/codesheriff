/**
 * BugFocusFilter unit tests
 */

import { describe, it, expect } from 'vitest';
import { BugFocusFilter, classifyFinding } from '../filters/bug-focus.js';
import { Severity, FindingCategory } from '@codesheriff/shared';
import type { RawFinding } from '@codesheriff/shared';

function makeFinding(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    ruleId: 'test:rule',
    title: 'Test finding',
    description: 'Test description',
    severity: Severity.MEDIUM,
    category: FindingCategory.QUALITY,
    filePath: 'src/test.ts',
    lineStart: 1,
    lineEnd: 1,
    codeSnippet: 'const x = 1;',
    isAIPatternSpecific: false,
    detector: 'StaticAnalyzer',
    ...overrides,
  };
}

describe('classifyFinding', () => {
  it('SECURITY category → BUG', () => {
    const f = makeFinding({ category: FindingCategory.SECURITY });
    expect(classifyFinding(f)).toBe('BUG');
  });

  it('AUTH category → BUG', () => {
    const f = makeFinding({ category: FindingCategory.AUTH });
    expect(classifyFinding(f)).toBe('BUG');
  });

  it('SECRET category → BUG', () => {
    const f = makeFinding({ category: FindingCategory.SECRET });
    expect(classifyFinding(f)).toBe('BUG');
  });

  it('HALLUCINATION category → BUG', () => {
    const f = makeFinding({ category: FindingCategory.HALLUCINATION });
    expect(classifyFinding(f)).toBe('BUG');
  });

  it('LOGIC category → BUG', () => {
    const f = makeFinding({ category: FindingCategory.LOGIC });
    expect(classifyFinding(f)).toBe('BUG');
  });

  it('QUALITY + "consider using async/await" → STYLE', () => {
    const f = makeFinding({
      category: FindingCategory.QUALITY,
      title: 'Consider using async/await',
      description: 'You should prefer async/await over raw promises.',
    });
    expect(classifyFinding(f)).toBe('STYLE');
  });

  it('QUALITY + "null pointer dereference" → BUG', () => {
    const f = makeFinding({
      category: FindingCategory.QUALITY,
      title: 'Null pointer dereference',
      description: 'Potential null pointer dereference at line 42.',
    });
    expect(classifyFinding(f)).toBe('BUG');
  });

  it('CRITICAL severity QUALITY → BUG', () => {
    const f = makeFinding({
      category: FindingCategory.QUALITY,
      severity: Severity.CRITICAL,
      title: 'Code style issue',
      description: 'Naming convention not followed.',
    });
    expect(classifyFinding(f)).toBe('BUG');
  });

  it('SecretsScanner detector → always BUG', () => {
    const f = makeFinding({
      category: FindingCategory.QUALITY,
      detector: 'SecretsScanner',
      title: 'Naming convention violation',
      description: 'Consider using a different name.',
    });
    expect(classifyFinding(f)).toBe('BUG');
  });

  it('"naming convention" QUALITY → STYLE', () => {
    const f = makeFinding({
      category: FindingCategory.QUALITY,
      title: 'Naming convention not followed',
      description: 'Variable names should follow camelCase.',
    });
    expect(classifyFinding(f)).toBe('STYLE');
  });

  it('"race condition" QUALITY → BUG', () => {
    const f = makeFinding({
      category: FindingCategory.QUALITY,
      title: 'Possible race condition',
      description: 'Shared mutable state accessed from multiple goroutines.',
    });
    expect(classifyFinding(f)).toBe('BUG');
  });

  it('"refactor" QUALITY → STYLE', () => {
    const f = makeFinding({
      category: FindingCategory.QUALITY,
      title: 'Refactor this method',
      description: 'Extract method for readability.',
    });
    expect(classifyFinding(f)).toBe('STYLE');
  });

  it('"memory leak" QUALITY → BUG', () => {
    const f = makeFinding({
      category: FindingCategory.QUALITY,
      title: 'Memory leak detected',
      description: 'Resource not released after use.',
    });
    expect(classifyFinding(f)).toBe('BUG');
  });
});

describe('BugFocusFilter', () => {
  const filter = new BugFocusFilter();

  it('returns empty array for empty input', () => {
    expect(filter.filter([])).toEqual([]);
  });

  it('drops STYLE findings and keeps BUG findings', () => {
    const findings = [
      makeFinding({ category: FindingCategory.SECURITY, title: 'SQL injection' }),
      makeFinding({ category: FindingCategory.QUALITY, title: 'Consider using async/await', description: 'prefer promises' }),
      makeFinding({ category: FindingCategory.AUTH }),
      makeFinding({ category: FindingCategory.QUALITY, title: 'Unused import', description: 'unused import detected' }),
    ];

    const result = filter.filter(findings);
    expect(result).toHaveLength(2);
    expect(result[0]?.category).toBe(FindingCategory.SECURITY);
    expect(result[1]?.category).toBe(FindingCategory.AUTH);
  });

  it('keeps all findings when all are BUG', () => {
    const findings = [
      makeFinding({ category: FindingCategory.SECURITY }),
      makeFinding({ category: FindingCategory.AUTH }),
      makeFinding({ category: FindingCategory.SECRET }),
    ];
    expect(filter.filter(findings)).toHaveLength(3);
  });

  it('drops all findings when all are STYLE', () => {
    const findings = [
      makeFinding({ title: 'Formatting issue', description: 'indentation inconsistent' }),
      makeFinding({ title: 'Missing comment', description: 'missing jsdoc for this function' }),
    ];
    expect(filter.filter(findings)).toHaveLength(0);
  });
});
