/**
 * Tests for AIPatternDetector — static regex heuristics and the stack-based
 * oversized-function detector.
 */

import { describe, it, expect } from 'vitest';
import { AIPatternDetector } from '../detectors/ai-pattern.js';
import { Severity, FindingCategory } from '@codesheriff/shared';
import type { AnalysisFile } from '@codesheriff/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(
  path: string,
  content: string,
  overrides: Partial<AnalysisFile> = {}
): AnalysisFile {
  const lines = content.split('\n');
  return {
    path,
    content,
    language: 'typescript',
    lineCount: lines.length,
    status: 'modified',
    additions: lines.length,
    deletions: 0,
    ...overrides,
  };
}

/** Build a string with N lines of filler content */
function makeLines(n: number, filler = '  const x = 1;'): string {
  return Array.from({ length: n }, () => filler).join('\n');
}

const SCAN_ID = 'test-scan-001';
const detector = new AIPatternDetector();

// ---------------------------------------------------------------------------
// Basic detection — known pattern rules
// ---------------------------------------------------------------------------

describe('AIPatternDetector.detect — pattern rules', () => {
  it('returns empty findings for an empty file list', async () => {
    const { findings, signatures } = await detector.detect(SCAN_ID, []);
    expect(findings).toHaveLength(0);
    expect(signatures).toHaveLength(0);
  });

  it('skips deleted files', async () => {
    const file = makeFile('src/old.ts', 'const x = 1;', { status: 'deleted' });
    const { findings, signatures } = await detector.detect(SCAN_ID, [file]);
    expect(findings).toHaveLength(0);
    expect(signatures).toHaveLength(0);
  });

  it('skips files with more than 5000 lines', async () => {
    const content = makeLines(5_001);
    const file = makeFile('src/huge.ts', content, { lineCount: 5_001 });
    const { findings } = await detector.detect(SCAN_ID, [file]);
    // Should have no pattern findings (only oversized-fn possibly, but file is
    // rejected before that code runs)
    expect(findings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Overly verbose variable name (>35 chars) — minConfidence 0.6 → signature only
  // -------------------------------------------------------------------------

  it('records a signature (not a finding) for verbose variable names', async () => {
    const content = 'const thisIsAnExtremelyLongVariableNameThatIsOverThirtyFiveCharsLong = 1;';
    const file = makeFile('src/verbose.ts', content);
    const { findings, signatures } = await detector.detect(SCAN_ID, [file]);
    // minConfidence 0.6 is ≤ 0.7 threshold → no explicit finding
    expect(findings).toHaveLength(0);
    expect(signatures.some((s) => s.name === 'Overly verbose variable name')).toBe(true);
  });

  it('does not flag short variable names', async () => {
    const content = 'const userId = 1;';
    const file = makeFile('src/clean.ts', content);
    const { signatures } = await detector.detect(SCAN_ID, [file]);
    expect(signatures.some((s) => s.name === 'Overly verbose variable name')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Obvious comment — minConfidence 0.5 → signature only
  // -------------------------------------------------------------------------

  it('records a signature for obvious comments starting with "increment"', async () => {
    const content = '// increment the counter\ncounter++;';
    const file = makeFile('src/obvious.ts', content);
    const { signatures } = await detector.detect(SCAN_ID, [file]);
    expect(signatures.some((s) => s.name === 'Obvious comment')).toBe(true);
  });

  it('records a signature for obvious comments starting with "loop through"', async () => {
    const content = '// loop through all users\nfor (const u of users) {}';
    const file = makeFile('src/loop.ts', content);
    const { signatures } = await detector.detect(SCAN_ID, [file]);
    expect(signatures.some((s) => s.name === 'Obvious comment')).toBe(true);
  });

  it('does not flag meaningful comments', async () => {
    const content = '// Compensates for off-by-one in legacy CSV parser\nconst offset = 1;';
    const file = makeFile('src/meaningful.ts', content);
    const { signatures } = await detector.detect(SCAN_ID, [file]);
    expect(signatures.some((s) => s.name === 'Obvious comment')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Dead code branch — minConfidence 0.9 → explicit FINDING
  // -------------------------------------------------------------------------

  it('emits a finding for if(false) dead code', async () => {
    const content = 'if (false) { doSomething(); }';
    const file = makeFile('src/dead.ts', content);
    const { findings } = await detector.detect(SCAN_ID, [file]);
    const match = findings.find((f) => f.title === 'Dead code branch');
    expect(match).toBeDefined();
    expect(match?.severity).toBe(Severity.LOW);
    expect(match?.category).toBe(FindingCategory.QUALITY);
    expect(match?.isAIPatternSpecific).toBe(true);
    expect(match?.detector).toBe('AIPatternDetector');
  });

  it('emits a finding for if(0) dead code', async () => {
    const content = 'if (0) { neverRuns(); }';
    const file = makeFile('src/zero.ts', content);
    const { findings } = await detector.detect(SCAN_ID, [file]);
    expect(findings.some((f) => f.title === 'Dead code branch')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Password comparison — minConfidence 0.85 → explicit FINDING (CRITICAL)
  // -------------------------------------------------------------------------

  it('emits a CRITICAL finding for plaintext password comparison with ==', async () => {
    const content = 'if (password == "secret123") { grantAccess(); }';
    const file = makeFile('src/auth.ts', content);
    const { findings } = await detector.detect(SCAN_ID, [file]);
    const match = findings.find((f) => f.title === 'Password comparison with == operator');
    expect(match).toBeDefined();
    expect(match?.severity).toBe(Severity.CRITICAL);
  });

  it('emits a CRITICAL finding for .password === comparison', async () => {
    const content = 'if (user.password === inputPassword) return true;';
    const file = makeFile('src/auth2.ts', content);
    const { findings } = await detector.detect(SCAN_ID, [file]);
    expect(findings.some((f) => f.title === 'Password comparison with == operator')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // API key in source code — minConfidence 0.8 → explicit FINDING (CRITICAL)
  // -------------------------------------------------------------------------

  it('emits a CRITICAL finding for hardcoded apiKey assignment', async () => {
    // Use an obviously fake key pattern — not a real credential format
    const content = 'const apiKey = "FAKE-KEY-0000000000000000000000000000";';
    const file = makeFile('src/config.ts', content);
    const { findings } = await detector.detect(SCAN_ID, [file]);
    const match = findings.find((f) => f.title === 'API key in source code');
    expect(match).toBeDefined();
    expect(match?.severity).toBe(Severity.CRITICAL);
  });

  it('does not flag apiKey read from process.env', async () => {
    const content = 'const apiKey = process.env.API_KEY ?? "";';
    const file = makeFile('src/safe-config.ts', content);
    const { findings } = await detector.detect(SCAN_ID, [file]);
    expect(findings.some((f) => f.title === 'API key in source code')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Finding metadata
  // -------------------------------------------------------------------------

  it('includes ruleId, filePath, lineStart, lineEnd on every finding', async () => {
    const content = 'if (false) { dead(); }';
    const file = makeFile('src/meta.ts', content);
    const { findings } = await detector.detect(SCAN_ID, [file]);
    for (const f of findings) {
      expect(f.ruleId).toBeTruthy();
      expect(f.filePath).toBe('src/meta.ts');
      expect(typeof f.lineStart).toBe('number');
      expect(typeof f.lineEnd).toBe('number');
    }
  });

  it('caps findings per file at exactly 20 when more than 20 patterns match', async () => {
    // 25 consecutive dead-code lines — each matches at minConfidence 0.9, so
    // each produces an explicit finding. The cap must stop accumulation at 20.
    const lines = Array.from({ length: 25 }, (_, i) => `if (false) { fn${i}(); }`);
    const content = lines.join('\n');
    const file = makeFile('src/many.ts', content, { lineCount: lines.length });
    const { findings } = await detector.detect(SCAN_ID, [file]);
    const patternFindings = findings.filter((f) => f.ruleId !== 'ai-pattern:oversized-function');
    // Exactly 20: cap is enforced, not just a ceiling — more than 20 inputs
    // should yield exactly 20 (not 25, and not 19).
    expect(patternFindings.length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Oversized function detection — stack-based implementation
// ---------------------------------------------------------------------------

describe('AIPatternDetector — oversized function detection', () => {
  it('does not flag a function under 100 lines', async () => {
    const body = makeLines(50, '  const x = 1;');
    const content = `function smallFunc() {\n${body}\n}`;
    const file = makeFile('src/small.ts', content, { lineCount: 52 });
    const { findings } = await detector.detect(SCAN_ID, [file]);
    expect(findings.some((f) => f.ruleId === 'ai-pattern:oversized-function')).toBe(false);
  });

  it('flags a function longer than 100 lines', async () => {
    const body = makeLines(105, '  const x = 1;');
    const content = `function hugeFunc() {\n${body}\n}`;
    const file = makeFile('src/huge-fn.ts', content, { lineCount: content.split('\n').length });
    const { findings } = await detector.detect(SCAN_ID, [file]);
    const match = findings.find((f) => f.ruleId === 'ai-pattern:oversized-function');
    expect(match).toBeDefined();
    expect(match?.severity).toBe(Severity.LOW);
    expect(match?.category).toBe(FindingCategory.QUALITY);
    expect(match?.lineStart).toBe(1); // function starts on line 1
  });

  it('handles multi-line function signatures where { is on the same line', async () => {
    // Signature split across lines; opening brace on the declaration line
    const body = makeLines(105, '  doWork();');
    const content = `function longSignature(\n  param1: string,\n  param2: number\n) {\n${body}\n}`;
    const file = makeFile('src/long-sig.ts', content, { lineCount: content.split('\n').length });
    const { findings } = await detector.detect(SCAN_ID, [file]);
    // Should detect the oversized function regardless of multi-line signature
    expect(findings.some((f) => f.ruleId === 'ai-pattern:oversized-function')).toBe(true);
  });

  it('handles nested functions — only outer function length is reported', async () => {
    // Outer function: 110 lines total (should be flagged)
    // Inner nested function: 5 lines (should not be flagged)
    const innerFn = `  function innerHelper() {\n${makeLines(5, '    const y = 2;')}\n  }`;
    const restOfOuter = makeLines(100, '  const z = 3;');
    const content = `function outerFunc() {\n${innerFn}\n${restOfOuter}\n}`;
    const lineCount = content.split('\n').length;
    const file = makeFile('src/nested.ts', content, { lineCount });
    const { findings } = await detector.detect(SCAN_ID, [file]);
    const oversized = findings.filter((f) => f.ruleId === 'ai-pattern:oversized-function');
    // Exactly 1: the outer function exceeds 100 lines; inner does not (5 lines)
    expect(oversized.length).toBe(1);
  });

  it('correctly tracks two consecutive large functions independently', async () => {
    const body = makeLines(105, '  const x = 1;');
    const fn1 = `function firstFunc() {\n${body}\n}`;
    const fn2 = `function secondFunc() {\n${body}\n}`;
    const content = `${fn1}\n\n${fn2}`;
    const lineCount = content.split('\n').length;
    const file = makeFile('src/two-fns.ts', content, { lineCount });
    const { findings } = await detector.detect(SCAN_ID, [file]);
    const oversized = findings.filter((f) => f.ruleId === 'ai-pattern:oversized-function');
    expect(oversized.length).toBe(2);
  });

  it('includes the correct line range and description in the finding', async () => {
    const body = makeLines(105, '  const x = 1;');
    const content = `function bigFunc() {\n${body}\n}`;
    const lineCount = content.split('\n').length;
    const file = makeFile('src/range-check.ts', content, { lineCount });
    const { findings } = await detector.detect(SCAN_ID, [file]);
    const match = findings.find((f) => f.ruleId === 'ai-pattern:oversized-function');
    expect(match).toBeDefined();
    // lineEnd should be greater than lineStart + 100
    expect(match!.lineEnd - match!.lineStart).toBeGreaterThan(100);
    expect(match!.description).toContain('lines long');
  });
});
