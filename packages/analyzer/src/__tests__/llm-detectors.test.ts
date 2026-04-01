/**
 * Tests for the three LLM-backed detectors:
 *   - HallucinationDetector
 *   - AuthFlowValidator
 *   - LogicBugDetector
 *
 * LlmClient is mocked with vi.fn() — no real API or Redis calls are made.
 * Tests verify filtering logic, response parsing, finding construction,
 * confidence thresholds, and error resilience.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HallucinationDetector } from '../detectors/hallucination.js';
import { AuthFlowValidator } from '../detectors/auth-flow.js';
import { LogicBugDetector } from '../detectors/logic-bug.js';
import { Severity, FindingCategory } from '@codesheriff/shared';
import type { AnalysisFile } from '@codesheriff/shared';
import type { LlmClient, LlmResponse } from '../llm/client.js';

// ---------------------------------------------------------------------------
// Test helpers
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
    patch: null,
    ...overrides,
  };
}

/** Build a minimal LlmClient mock whose `call()` returns the given JSON string */
function mockLlm(responseJson: string): LlmClient {
  return {
    call: vi.fn<Parameters<LlmClient['call']>, ReturnType<LlmClient['call']>>().mockResolvedValue({
      content: responseJson,
      cached: false,
      latencyMs: 10,
    } satisfies LlmResponse),
  } as unknown as LlmClient;
}

/** Build a mock LlmClient that throws on every call */
function errorLlm(message = 'LLM unavailable'): LlmClient {
  return {
    call: vi.fn().mockRejectedValue(new Error(message)),
  } as unknown as LlmClient;
}

const SCAN_ID = 'test-scan-llm-001';

// ===========================================================================
// HallucinationDetector
// ===========================================================================

describe('HallucinationDetector', () => {
  // -------------------------------------------------------------------------
  // File filtering
  // -------------------------------------------------------------------------

  it('skips deleted files', async () => {
    const llm = mockLlm('[]');
    const detector = new HallucinationDetector(llm);
    const file = makeFile('src/old.ts', 'const x = 1;', { status: 'deleted' });

    const findings = await detector.detect(SCAN_ID, [file], {});
    expect(findings).toHaveLength(0);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('skips files with unsupported language', async () => {
    const llm = mockLlm('[]');
    const detector = new HallucinationDetector(llm);
    const file = makeFile('src/code.java', 'class Foo {}', { language: 'java' });

    const findings = await detector.detect(SCAN_ID, [file], {});
    expect(findings).toHaveLength(0);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('skips files over 500 lines', async () => {
    const llm = mockLlm('[]');
    const detector = new HallucinationDetector(llm);
    const content = Array.from({ length: 501 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const file = makeFile('src/big.ts', content, { lineCount: 501 });

    const findings = await detector.detect(SCAN_ID, [file], {});
    expect(findings).toHaveLength(0);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('returns empty findings when LLM returns an empty array', async () => {
    const llm = mockLlm('[]');
    const detector = new HallucinationDetector(llm);
    const file = makeFile('src/main.ts', 'import { foo } from "bar";\nfoo();');

    const findings = await detector.detect(SCAN_ID, [file], { bar: '^1.0.0' });
    expect(findings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Response parsing and finding construction
  // -------------------------------------------------------------------------

  it('converts a valid LLM match above confidence threshold to a finding', async () => {
    const match = {
      line: 5,
      api: 'foo.nonExistentMethod',
      issue: 'Method does not exist in the bar library',
      confidence: 0.9,
    };
    const llm = mockLlm(JSON.stringify([match]));
    const detector = new HallucinationDetector(llm);

    const content = Array.from({ length: 10 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const file = makeFile('src/main.ts', content);

    const findings = await detector.detect(SCAN_ID, [file], { bar: '^1.0.0' });

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe('hallucination:api-usage');
    expect(f.category).toBe(FindingCategory.HALLUCINATION);
    expect(f.title).toContain('foo.nonExistentMethod');
    expect(f.lineStart).toBe(5);
    expect(f.isAIPatternSpecific).toBe(true);
    expect(f.detector).toBe('HallucinationDetector');
  });

  it('maps confidence >= 0.9 to HIGH severity, < 0.9 to MEDIUM', async () => {
    const matches = [
      { line: 1, api: 'highConfidenceApi', issue: 'Does not exist', confidence: 0.95 },
      { line: 2, api: 'mediumConfidenceApi', issue: 'Probably wrong', confidence: 0.8 },
    ];
    const llm = mockLlm(JSON.stringify(matches));
    const detector = new HallucinationDetector(llm);
    const file = makeFile('src/test.ts', 'const a = 1;\nconst b = 2;');

    const findings = await detector.detect(SCAN_ID, [file], {});

    expect(findings).toHaveLength(2);

    const high = findings.find((f) => f.metadata?.['confidence'] === 0.95);
    const medium = findings.find((f) => f.metadata?.['confidence'] === 0.8);

    // Validate metadata exists before accessing nested properties
    expect(high?.metadata).toBeDefined();
    expect(high?.metadata?.['confidence']).toBe(0.95);
    expect(high?.severity).toBe(Severity.HIGH);

    expect(medium?.metadata).toBeDefined();
    expect(medium?.metadata?.['confidence']).toBe(0.8);
    expect(medium?.severity).toBe(Severity.MEDIUM);
  });

  it('filters out matches below the minimum confidence threshold', async () => {
    // PIPELINE_DEFAULTS.HALLUCINATION_MIN_CONFIDENCE is 0.7
    const matches = [
      { line: 1, api: 'lowConfidenceApi', issue: 'Maybe wrong', confidence: 0.5 },
      { line: 2, api: 'highConfidenceApi', issue: 'Definitely wrong', confidence: 0.9 },
    ];
    const llm = mockLlm(JSON.stringify(matches));
    const detector = new HallucinationDetector(llm);
    const file = makeFile('src/test.ts', 'const a = 1;\nconst b = 2;');

    const findings = await detector.detect(SCAN_ID, [file], {});

    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toContain('highConfidenceApi');
  });

  it('handles malformed LLM JSON gracefully (returns empty findings)', async () => {
    const llm = mockLlm('this is not json');
    const detector = new HallucinationDetector(llm);
    const file = makeFile('src/main.ts', 'const x = 1;');

    const findings = await detector.detect(SCAN_ID, [file], {});
    expect(findings).toHaveLength(0);
  });

  it('handles LLM wrapped in markdown code fences', async () => {
    const match = { line: 1, api: 'badApi', issue: 'Not real', confidence: 0.9 };
    const llm = mockLlm(`\`\`\`json\n${JSON.stringify([match])}\n\`\`\``);
    const detector = new HallucinationDetector(llm);
    const file = makeFile('src/main.ts', 'const x = 1;');

    const findings = await detector.detect(SCAN_ID, [file], {});
    // The parser extracts [...]  from the response regardless of fences
    expect(findings).toHaveLength(1);
  });

  it('clamps out-of-bounds line numbers from the LLM to valid file range', async () => {
    // LLM returns line 999 for a 3-line file — clamping logic must prevent
    // an out-of-bounds array access and still produce a valid finding.
    const match = { line: 999, api: 'outOfBoundsApi', issue: 'Line out of range', confidence: 0.95 };
    const llm = mockLlm(JSON.stringify([match]));
    const detector = new HallucinationDetector(llm);
    const content = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    const file = makeFile('src/short.ts', content);

    const findings = await detector.detect(SCAN_ID, [file], {});
    // Should still produce a finding — not throw
    expect(findings).toHaveLength(1);
    // lineStart is the raw LLM value (used as-is by the detector)
    expect(findings[0]?.lineStart).toBe(999);
    // codeSnippet must not be undefined — clamped index safely resolved
    expect(findings[0]?.codeSnippet).toBeDefined();
  });

  it('does not propagate LLM errors — logs and continues to next file', async () => {
    const llm = errorLlm();
    const detector = new HallucinationDetector(llm);
    const file = makeFile('src/crash.ts', 'const x = 1;');

    // Should resolve without throwing
    const findings = await detector.detect(SCAN_ID, [file], {});
    expect(findings).toHaveLength(0);
  });
});

// ===========================================================================
// AuthFlowValidator
// ===========================================================================

describe('AuthFlowValidator', () => {
  // -------------------------------------------------------------------------
  // File filtering — auth heuristics
  // -------------------------------------------------------------------------

  it('skips non-auth files and does not call LLM', async () => {
    const llm = mockLlm('[]');
    const validator = new AuthFlowValidator(llm);
    const file = makeFile('src/utils/formatDate.ts', 'export const fmt = (d: Date) => d.toISOString();');

    const findings = await validator.detect(SCAN_ID, [file], 'express app');
    expect(findings).toHaveLength(0);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('includes files matching auth path patterns (auth in filename)', async () => {
    const llm = mockLlm('[]');
    const validator = new AuthFlowValidator(llm);
    const file = makeFile('src/middleware/auth.ts', 'export function auth() {}');

    await validator.detect(SCAN_ID, [file], 'context');
    expect(llm.call).toHaveBeenCalledOnce();
  });

  it('includes files with auth content patterns (jwt.verify)', async () => {
    const llm = mockLlm('[]');
    const validator = new AuthFlowValidator(llm);
    const file = makeFile('src/utils/verify.ts', 'jwt.verify(token, secret)');

    await validator.detect(SCAN_ID, [file], 'context');
    expect(llm.call).toHaveBeenCalledOnce();
  });

  it('skips deleted files', async () => {
    const llm = mockLlm('[]');
    const validator = new AuthFlowValidator(llm);
    const file = makeFile('src/auth/old.ts', 'jwt.verify(t, s)', { status: 'deleted' });

    await validator.detect(SCAN_ID, [file], 'ctx');
    expect(llm.call).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Response parsing and finding construction
  // -------------------------------------------------------------------------

  it('converts a valid auth issue to a finding', async () => {
    const issue = {
      severity: 'HIGH',
      issue: 'JWT is decoded without signature verification',
      line: 3,
      cwe: 'CWE-347',
    };
    const llm = mockLlm(JSON.stringify([issue]));
    const validator = new AuthFlowValidator(llm);
    const content = 'const h = req.headers;\nconst t = h.auth;\njwt.decode(t);';
    const file = makeFile('src/auth.ts', content);

    const findings = await validator.detect(SCAN_ID, [file], 'context');

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe('auth:cwe-347');
    expect(f.severity).toBe(Severity.HIGH);
    expect(f.category).toBe(FindingCategory.AUTH);
    expect(f.lineStart).toBe(3);
    expect(f.isAIPatternSpecific).toBe(true);
    expect(f.detector).toBe('AuthFlowValidator');
    expect(f.metadata?.['cwe']).toBe('CWE-347');
  });

  it('maps CRITICAL severity string to Severity.CRITICAL', async () => {
    const issue = { severity: 'CRITICAL', issue: 'Auth bypass', line: 1, cwe: 'CWE-306' };
    const llm = mockLlm(JSON.stringify([issue]));
    const validator = new AuthFlowValidator(llm);
    const file = makeFile('src/auth.ts', 'isAuthenticated(user);');

    const findings = await validator.detect(SCAN_ID, [file], '');
    expect(findings[0]?.severity).toBe(Severity.CRITICAL);
  });

  it('defaults to MEDIUM for unknown severity strings', async () => {
    const issue = { severity: 'BOGUS', issue: 'Something odd', line: 1, cwe: 'CWE-000' };
    const llm = mockLlm(JSON.stringify([issue]));
    const validator = new AuthFlowValidator(llm);
    const file = makeFile('src/auth.ts', 'authenticate(req);');

    const findings = await validator.detect(SCAN_ID, [file], '');
    expect(findings[0]?.severity).toBe(Severity.MEDIUM);
  });

  it('handles malformed LLM response gracefully', async () => {
    const llm = mockLlm('{not valid json}');
    const validator = new AuthFlowValidator(llm);
    const file = makeFile('src/auth.ts', 'jwt.verify(t, s)');

    const findings = await validator.detect(SCAN_ID, [file], '');
    expect(findings).toHaveLength(0);
  });

  it('does not propagate LLM errors', async () => {
    const llm = errorLlm('network error');
    const validator = new AuthFlowValidator(llm);
    const file = makeFile('src/auth.ts', 'authenticate(user)');

    await expect(validator.detect(SCAN_ID, [file], '')).resolves.toHaveLength(0);
  });
});

// ===========================================================================
// LogicBugDetector
// ===========================================================================

describe('LogicBugDetector', () => {
  // -------------------------------------------------------------------------
  // File filtering
  // -------------------------------------------------------------------------

  it('skips deleted files', async () => {
    const llm = mockLlm('[]');
    const detector = new LogicBugDetector(llm);
    const file = makeFile('src/removed.ts', 'const x = 1;', { status: 'deleted' });

    await detector.detect(SCAN_ID, [file]);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('skips .d.ts declaration files', async () => {
    const llm = mockLlm('[]');
    const detector = new LogicBugDetector(llm);
    const file = makeFile('src/types.d.ts', 'export type Foo = string;');

    await detector.detect(SCAN_ID, [file]);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('skips .min.js files', async () => {
    const llm = mockLlm('[]');
    const detector = new LogicBugDetector(llm);
    const file = makeFile('dist/bundle.min.js', 'a=1;b=2;');

    await detector.detect(SCAN_ID, [file]);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('skips files over 400 lines', async () => {
    const llm = mockLlm('[]');
    const detector = new LogicBugDetector(llm);
    const content = Array.from({ length: 401 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const file = makeFile('src/large.ts', content, { lineCount: 401 });

    await detector.detect(SCAN_ID, [file]);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('skips files with fewer than 5 diff lines when patch is provided', async () => {
    const llm = mockLlm('[]');
    const detector = new LogicBugDetector(llm);
    // Patch with only 2 added lines — below the 5-line minimum threshold.
    // Lines starting with '+' or '-' count; context lines (space-prefixed) do not.
    const file = makeFile('src/minor.ts', 'const x = 1;\nconst y = 2;', {
      patch: '+const x = 1;\n+const y = 2;\n unchanged context\n',
    });

    await detector.detect(SCAN_ID, [file]);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('analyzes files where patch is null (full file scan)', async () => {
    const llm = mockLlm('[]');
    const detector = new LogicBugDetector(llm);
    const file = makeFile('src/code.ts', 'const x = 1;\nconst y = 2;', { patch: null });

    await detector.detect(SCAN_ID, [file]);
    expect(llm.call).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Response parsing and finding construction
  // -------------------------------------------------------------------------

  it('converts a valid logic bug to a finding', async () => {
    const bug = {
      line: 7,
      bug: 'Off-by-one error in loop boundary. Array length used as index.',
      severity: 'HIGH',
      fix: 'Use arr.length - 1 as the upper bound.',
    };
    const llm = mockLlm(JSON.stringify([bug]));
    const detector = new LogicBugDetector(llm);
    const lines = Array.from({ length: 10 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const file = makeFile('src/loop.ts', lines, { patch: null });

    const findings = await detector.detect(SCAN_ID, [file]);

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe('logic:ai-generated-bug');
    expect(f.severity).toBe(Severity.HIGH);
    expect(f.category).toBe(FindingCategory.LOGIC);
    expect(f.lineStart).toBe(7);
    expect(f.isAIPatternSpecific).toBe(true);
    expect(f.detector).toBe('LogicBugDetector');
    expect(f.metadata?.['fix']).toBe('Use arr.length - 1 as the upper bound.');
  });

  it('truncates title at the first period', async () => {
    const bug = {
      line: 1,
      bug: 'Null pointer exception. Happens when user is undefined.',
      severity: 'MEDIUM',
      fix: 'Add null check.',
    };
    const llm = mockLlm(JSON.stringify([bug]));
    const detector = new LogicBugDetector(llm);
    const file = makeFile('src/code.ts', 'fn(user)', { patch: null });

    const findings = await detector.detect(SCAN_ID, [file]);
    expect(findings[0]?.title).toBe('Null pointer exception');
  });

  it('maps LOW severity string correctly', async () => {
    const bug = { line: 1, bug: 'Minor issue.', severity: 'LOW', fix: 'Small fix.' };
    const llm = mockLlm(JSON.stringify([bug]));
    const detector = new LogicBugDetector(llm);
    const file = makeFile('src/code.ts', 'const x = 1;', { patch: null });

    const findings = await detector.detect(SCAN_ID, [file]);
    expect(findings[0]?.severity).toBe(Severity.LOW);
  });

  it('skips malformed bug objects that fail type guard', async () => {
    // Missing required 'fix' field
    const badBug = { line: 1, bug: 'Something', severity: 'HIGH' };
    const goodBug = { line: 2, bug: 'Real issue.', severity: 'MEDIUM', fix: 'Do this.' };
    const llm = mockLlm(JSON.stringify([badBug, goodBug]));
    const detector = new LogicBugDetector(llm);
    const file = makeFile('src/code.ts', 'const a = 1;\nconst b = 2;', { patch: null });

    const findings = await detector.detect(SCAN_ID, [file]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.lineStart).toBe(2);
  });

  it('does not propagate LLM errors', async () => {
    const llm = errorLlm('timeout');
    const detector = new LogicBugDetector(llm);
    const file = makeFile('src/code.ts', 'const x = 1;', { patch: null });

    await expect(detector.detect(SCAN_ID, [file])).resolves.toHaveLength(0);
  });

  it('handles multiple files and accumulates findings across all of them', async () => {
    const bugA = { line: 1, bug: 'Bug in A.', severity: 'HIGH', fix: 'Fix A.' };
    const bugB = { line: 1, bug: 'Bug in B.', severity: 'LOW', fix: 'Fix B.' };

    // Use mockResolvedValueOnce (queued) instead of a stateful counter so the
    // test doesn't depend on call-ordering assumptions.
    const llm: LlmClient = {
      call: vi.fn<Parameters<LlmClient['call']>, ReturnType<LlmClient['call']>>()
        .mockResolvedValueOnce({ content: JSON.stringify([bugA]), cached: false, latencyMs: 5 } satisfies LlmResponse)
        .mockResolvedValueOnce({ content: JSON.stringify([bugB]), cached: false, latencyMs: 5 } satisfies LlmResponse),
    } as unknown as LlmClient;

    const detector = new LogicBugDetector(llm);
    const fileA = makeFile('src/a.ts', 'const a = 1;', { patch: null });
    const fileB = makeFile('src/b.ts', 'const b = 2;', { patch: null });

    const findings = await detector.detect(SCAN_ID, [fileA, fileB]);
    expect(findings).toHaveLength(2);
    // LogicBugDetector processes files sequentially, so ordering is deterministic
    expect(findings[0]?.filePath).toBe('src/a.ts');
    expect(findings[1]?.filePath).toBe('src/b.ts');
  });
});
