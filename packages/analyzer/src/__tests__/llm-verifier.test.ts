/**
 * LlmVerifier unit tests
 */

import { describe, it, expect, vi } from 'vitest';
import { LlmVerifier, verifyFinding } from '../filters/llm-verifier.js';
import { Severity, FindingCategory } from '@codesheriff/shared';
import type { RawFinding } from '@codesheriff/shared';
import type { LlmClient } from '../llm/client.js';

function makeFinding(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    ruleId: 'test:rule',
    title: 'Potential null dereference',
    description: 'Variable may be null at this point',
    severity: Severity.MEDIUM,
    category: FindingCategory.LOGIC,
    filePath: 'src/handler.ts',
    lineStart: 10,
    lineEnd: 15,
    codeSnippet: 'return user.profile.name;',
    isAIPatternSpecific: false,
    detector: 'LogicBugDetector',
    ...overrides,
  };
}

function mockLlm(responseContent: string): LlmClient {
  return {
    call: vi.fn().mockResolvedValue({
      content: responseContent,
      cached: false,
      latencyMs: 50,
    }),
  } as unknown as LlmClient;
}

// ---------------------------------------------------------------------------
// verifyFinding (standalone function)
// ---------------------------------------------------------------------------

describe('verifyFinding', () => {
  it('returns REAL_BUG for REAL_BUG verdict', async () => {
    const llm = mockLlm('{"verdict":"REAL_BUG","reason":"null dereference at runtime"}');
    const result = await verifyFinding(makeFinding(), llm);
    expect(result.verdict).toBe('REAL_BUG');
    expect(result.reason).toBe('null dereference at runtime');
  });

  it('returns FALSE_POSITIVE for FALSE_POSITIVE verdict', async () => {
    const llm = mockLlm('{"verdict":"FALSE_POSITIVE","reason":"not a real concern here"}');
    const result = await verifyFinding(makeFinding(), llm);
    expect(result.verdict).toBe('FALSE_POSITIVE');
  });

  it('normalizes lowercase verdict to uppercase', async () => {
    const llm = mockLlm('{"verdict":"real_bug","reason":"lowercase verdict normalized"}');
    const result = await verifyFinding(makeFinding(), llm);
    expect(result.verdict).toBe('REAL_BUG');
  });

  it('normalizes mixed-case FALSE_POSITIVE', async () => {
    const llm = mockLlm('{"verdict":"false_positive","reason":"mixed case"}');
    const result = await verifyFinding(makeFinding(), llm);
    expect(result.verdict).toBe('FALSE_POSITIVE');
  });

  it('extracts JSON even when model adds surrounding prose', async () => {
    const llm = mockLlm(
      'Based on my analysis: {"verdict":"FALSE_POSITIVE","reason":"style only"} Hope that helps!'
    );
    const result = await verifyFinding(makeFinding(), llm);
    expect(result.verdict).toBe('FALSE_POSITIVE');
  });

  it('throws when no JSON found in response', async () => {
    const llm = mockLlm('This is not JSON at all');
    await expect(verifyFinding(makeFinding(), llm)).rejects.toThrow('no JSON');
  });

  it('throws on unexpected verdict value', async () => {
    const llm = mockLlm('{"verdict":"MAYBE","reason":"uncertain"}');
    await expect(verifyFinding(makeFinding(), llm)).rejects.toThrow('unexpected verdict');
  });

  it('handles empty codeSnippet gracefully', async () => {
    const llm = mockLlm('{"verdict":"REAL_BUG","reason":"bug"}');
    const finding = makeFinding({ codeSnippet: '' });
    const result = await verifyFinding(finding, llm);
    expect(result.verdict).toBe('REAL_BUG');
  });

  it('falls back to title when description is empty', async () => {
    const llm = mockLlm('{"verdict":"REAL_BUG","reason":"bug"}');
    const finding = makeFinding({ description: '' });
    await expect(verifyFinding(finding, llm)).resolves.not.toThrow();
    const calls = (llm.call as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]![0].userPrompt).toContain(finding.title);
  });

  it('ignores extra fields in verdict JSON', async () => {
    const llm = mockLlm(
      '{"verdict":"REAL_BUG","reason":"crash","confidence":0.95,"extra":"ignored"}'
    );
    const result = await verifyFinding(makeFinding(), llm);
    expect(result.verdict).toBe('REAL_BUG');
  });
});

// ---------------------------------------------------------------------------
// LlmVerifier class
// ---------------------------------------------------------------------------

describe('LlmVerifier', () => {
  it('keeps findings with REAL_BUG verdict', async () => {
    const llm = mockLlm('{"verdict":"REAL_BUG","reason":"real bug"}');
    const verifier = new LlmVerifier(llm);
    const findings = [makeFinding(), makeFinding({ title: 'Another bug', ruleId: 'rule-2' })];
    const result = await verifier.verify('scan-1', findings);
    expect(result).toHaveLength(2);
  });

  it('drops findings with FALSE_POSITIVE verdict', async () => {
    const llm = mockLlm('{"verdict":"FALSE_POSITIVE","reason":"style preference"}');
    const verifier = new LlmVerifier(llm);
    const findings = [makeFinding(), makeFinding({ title: 'Another', ruleId: 'rule-2' })];
    const result = await verifier.verify('scan-1', findings);
    expect(result).toHaveLength(0);
  });

  it('keeps CRITICAL severity findings without calling LLM', async () => {
    const llm = mockLlm('{"verdict":"FALSE_POSITIVE","reason":"style"}');
    const callSpy = vi.spyOn(llm, 'call');
    const verifier = new LlmVerifier(llm);
    const findings = [makeFinding({ severity: Severity.CRITICAL })];
    const result = await verifier.verify('scan-1', findings);
    expect(result).toHaveLength(1);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('keeps SecretsScanner findings without calling LLM', async () => {
    const llm = mockLlm('{"verdict":"FALSE_POSITIVE","reason":"style"}');
    const callSpy = vi.spyOn(llm, 'call');
    const verifier = new LlmVerifier(llm);
    const findings = [makeFinding({ detector: 'SecretsScanner', category: FindingCategory.SECRET })];
    const result = await verifier.verify('scan-1', findings);
    expect(result).toHaveLength(1);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('fails open on LLM API error (keeps finding)', async () => {
    const llm = {
      call: vi.fn().mockRejectedValue(new Error('API timeout')),
    } as unknown as LlmClient;
    const verifier = new LlmVerifier(llm);
    const findings = [makeFinding()];
    const result = await verifier.verify('scan-1', findings);
    expect(result).toHaveLength(1);
  });

  it('fails open on JSON parse error (keeps finding)', async () => {
    const llm = mockLlm('not valid json');
    const verifier = new LlmVerifier(llm);
    const findings = [makeFinding()];
    const result = await verifier.verify('scan-1', findings);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty input', async () => {
    const llm = mockLlm('{"verdict":"REAL_BUG","reason":"bug"}');
    const verifier = new LlmVerifier(llm);
    const result = await verifier.verify('scan-1', []);
    expect(result).toHaveLength(0);
    expect((llm.call as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('processes mixed REAL_BUG and FALSE_POSITIVE correctly', async () => {
    const llm = {
      call: vi.fn()
        .mockResolvedValueOnce({ content: '{"verdict":"REAL_BUG","reason":"real"}', cached: false, latencyMs: 10 })
        .mockResolvedValueOnce({ content: '{"verdict":"FALSE_POSITIVE","reason":"style"}', cached: false, latencyMs: 10 })
        .mockResolvedValueOnce({ content: '{"verdict":"REAL_BUG","reason":"real"}', cached: false, latencyMs: 10 }),
    } as unknown as LlmClient;
    const verifier = new LlmVerifier(llm);
    const findings = [
      makeFinding({ ruleId: 'rule-1' }),
      makeFinding({ ruleId: 'rule-2' }),
      makeFinding({ ruleId: 'rule-3' }),
    ];
    const result = await verifier.verify('scan-1', findings);
    expect(result).toHaveLength(2);
    expect(result[0]!.ruleId).toBe('rule-1');
    expect(result[1]!.ruleId).toBe('rule-3');
  });

  it('respects MAX_CONCURRENCY of 5 (no more than 5 concurrent calls)', async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;

    const llm = {
      call: vi.fn().mockImplementation(async () => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        // Simulate async work
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        concurrentCalls--;
        return { content: '{"verdict":"REAL_BUG","reason":"bug"}', cached: false, latencyMs: 5 };
      }),
    } as unknown as LlmClient;

    const verifier = new LlmVerifier(llm);
    const findings = Array.from({ length: 12 }, (_, i) =>
      makeFinding({ ruleId: `rule-${i}`, title: `Finding ${i}` })
    );

    await verifier.verify('scan-concurrency', findings);
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });
});
