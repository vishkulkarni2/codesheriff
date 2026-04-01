/**
 * Integration tests for AnalysisPipeline.
 *
 * All detectors and the LlmClient are mocked at the module level so the
 * pipeline's orchestration logic (stage ordering, feature flags, error
 * isolation, concurrent merge, scoring) can be tested without real API calls
 * or subprocesses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — declared BEFORE any imports of the mocked modules
// ---------------------------------------------------------------------------

vi.mock('../llm/client.js', () => ({
  LlmClient: vi.fn().mockImplementation(() => ({
    call: vi.fn().mockResolvedValue({ content: '[]', cached: false, latencyMs: 0 }),
  })),
}));

vi.mock('../detectors/ai-pattern.js', () => ({
  AIPatternDetector: vi.fn().mockImplementation(() => ({
    detect: vi.fn().mockResolvedValue({ findings: [], signatures: [] }),
  })),
}));

vi.mock('../detectors/secrets.js', () => ({
  SecretsScanner: vi.fn().mockImplementation(() => ({
    detect: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../detectors/static.js', () => ({
  StaticAnalyzer: vi.fn().mockImplementation(() => ({
    detect: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../detectors/hallucination.js', () => ({
  HallucinationDetector: vi.fn().mockImplementation(() => ({
    detect: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../detectors/auth-flow.js', () => ({
  AuthFlowValidator: vi.fn().mockImplementation(() => ({
    detect: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../detectors/logic-bug.js', () => ({
  LogicBugDetector: vi.fn().mockImplementation(() => ({
    detect: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../detectors/explanation.js', () => ({
  ExplanationEngine: vi.fn().mockImplementation(() => ({
    enrich: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Now import the real subjects (mocks are already registered above)
// ---------------------------------------------------------------------------

import { AnalysisPipeline } from '../pipeline.js';
import { AIPatternDetector } from '../detectors/ai-pattern.js';
import { SecretsScanner } from '../detectors/secrets.js';
import { StaticAnalyzer } from '../detectors/static.js';
import { HallucinationDetector } from '../detectors/hallucination.js';
import { AuthFlowValidator } from '../detectors/auth-flow.js';
import { LogicBugDetector } from '../detectors/logic-bug.js';
import { ExplanationEngine } from '../detectors/explanation.js';

import { Severity, FindingCategory } from '@codesheriff/shared';
import type { AnalysisContext, RawFinding, DetectorName } from '@codesheriff/shared';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  return {
    scanId: 'pipeline-test-001',
    repoFullName: 'acme/web',
    branch: 'main',
    commitSha: 'a'.repeat(40),
    provider: 'github',
    files: [],
    dependencies: {},
    features: {
      enableHallucinationDetection: true,
      enableAuthValidation: true,
      enableLogicBugDetection: true,
      enableSecretsScanning: true,
      enableStaticAnalysis: true,
      maxFilesPerScan: 50,
      maxLinesPerFile: 1_000,
    },
    ...overrides,
  };
}

function makeFinding(
  severity: Severity = Severity.HIGH,
  detector: DetectorName = 'StaticAnalyzer'
): RawFinding {
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
    isAIPatternSpecific: false,
    detector,
  };
}

/** Helper: get the mock instance of a class created by AnalysisPipeline */
function getMockInstance<T>(MockClass: Mock): T {
  // Vitest tracks all `new` calls in mock.instances
  return (MockClass as { mock: { instances: T[] } }).mock.instances[0]!;
}

const PIPELINE_CONFIG = {
  anthropicApiKey: 'sk-test',
  redis: {} as never,
};

// ---------------------------------------------------------------------------
// beforeEach: reset all mocks so each test starts fresh
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// Pipeline structure
// ===========================================================================

describe('AnalysisPipeline.run — structure', () => {
  it('always resolves (never throws) even when all detectors fail', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);

    // Make every detector throw
    const aiInst = getMockInstance<{ detect: Mock }>(AIPatternDetector as unknown as Mock);
    aiInst.detect.mockRejectedValueOnce(new Error('ai boom'));
    const secretsInst = getMockInstance<{ detect: Mock }>(SecretsScanner as unknown as Mock);
    secretsInst.detect.mockRejectedValueOnce(new Error('secrets boom'));
    const staticInst = getMockInstance<{ detect: Mock }>(StaticAnalyzer as unknown as Mock);
    staticInst.detect.mockRejectedValueOnce(new Error('static boom'));
    const hallInst = getMockInstance<{ detect: Mock }>(HallucinationDetector as unknown as Mock);
    hallInst.detect.mockRejectedValueOnce(new Error('hallucination boom'));
    const authInst = getMockInstance<{ detect: Mock }>(AuthFlowValidator as unknown as Mock);
    authInst.detect.mockRejectedValueOnce(new Error('auth boom'));
    const logicInst = getMockInstance<{ detect: Mock }>(LogicBugDetector as unknown as Mock);
    logicInst.detect.mockRejectedValueOnce(new Error('logic boom'));

    const ctx = makeContext();
    await expect(pipeline.run(ctx)).resolves.toBeDefined();
  });

  it('returns a PipelineResult with the correct scanId', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);
    const ctx = makeContext({ scanId: 'my-custom-scan-id' });
    const result = await pipeline.run(ctx);
    expect(result.scanId).toBe('my-custom-scan-id');
  });

  it('result has findings, riskScore, durationMs, detectorTimings, errors', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);
    const result = await pipeline.run(makeContext());

    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.riskScore).toBe('number');
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.detectorTimings).toBeDefined();
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('returns riskScore 0 when no findings are emitted', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);
    const result = await pipeline.run(makeContext());
    expect(result.riskScore).toBe(0);
    expect(result.findings).toHaveLength(0);
  });
});

// ===========================================================================
// Feature flag gating
// ===========================================================================

describe('AnalysisPipeline.run — feature flags', () => {
  it('does not call SecretsScanner when enableSecretsScanning is false', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);
    const secretsInst = getMockInstance<{ detect: Mock }>(SecretsScanner as unknown as Mock);

    const ctx = makeContext({ features: { ...makeContext().features, enableSecretsScanning: false } });
    await pipeline.run(ctx);

    expect(secretsInst.detect).not.toHaveBeenCalled();
  });

  it('does not call StaticAnalyzer when enableStaticAnalysis is false', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);
    const staticInst = getMockInstance<{ detect: Mock }>(StaticAnalyzer as unknown as Mock);

    const ctx = makeContext({ features: { ...makeContext().features, enableStaticAnalysis: false } });
    await pipeline.run(ctx);

    expect(staticInst.detect).not.toHaveBeenCalled();
  });

  it('does not call HallucinationDetector when enableHallucinationDetection is false', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);
    const hallInst = getMockInstance<{ detect: Mock }>(HallucinationDetector as unknown as Mock);

    const ctx = makeContext({ features: { ...makeContext().features, enableHallucinationDetection: false } });
    await pipeline.run(ctx);

    expect(hallInst.detect).not.toHaveBeenCalled();
  });

  it('does not call AuthFlowValidator when enableAuthValidation is false', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);
    const authInst = getMockInstance<{ detect: Mock }>(AuthFlowValidator as unknown as Mock);

    const ctx = makeContext({ features: { ...makeContext().features, enableAuthValidation: false } });
    await pipeline.run(ctx);

    expect(authInst.detect).not.toHaveBeenCalled();
  });

  it('does not call LogicBugDetector when enableLogicBugDetection is false', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);
    const logicInst = getMockInstance<{ detect: Mock }>(LogicBugDetector as unknown as Mock);

    const ctx = makeContext({ features: { ...makeContext().features, enableLogicBugDetection: false } });
    await pipeline.run(ctx);

    expect(logicInst.detect).not.toHaveBeenCalled();
  });

  it('truncates files to maxFilesPerScan before passing to detectors', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);
    const aiInst = getMockInstance<{ detect: Mock }>(AIPatternDetector as unknown as Mock);
    aiInst.detect.mockResolvedValueOnce({ findings: [], signatures: [] });

    const files = Array.from({ length: 30 }, (_, i) => ({
      path: `src/file${i}.ts`,
      content: `const x${i} = ${i};`,
      language: 'typescript',
      lineCount: 1,
      status: 'modified' as const,
      additions: 1,
      deletions: 0,
      patch: null,
    }));

    const ctx = makeContext({
      files,
      features: { ...makeContext().features, maxFilesPerScan: 10 },
    });

    await pipeline.run(ctx);

    const [, filesPassed] = aiInst.detect.mock.calls[0]!;
    expect((filesPassed as typeof files).length).toBe(10);
  });
});

// ===========================================================================
// Finding accumulation
// ===========================================================================

describe('AnalysisPipeline.run — finding accumulation', () => {
  it('accumulates findings from all detectors into result.findings', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);

    const aiInst = getMockInstance<{ detect: Mock }>(AIPatternDetector as unknown as Mock);
    aiInst.detect.mockResolvedValueOnce({
      findings: [makeFinding(Severity.INFO, 'AIPatternDetector')],
      signatures: [],
    });

    const staticInst = getMockInstance<{ detect: Mock }>(StaticAnalyzer as unknown as Mock);
    staticInst.detect.mockResolvedValueOnce([makeFinding(Severity.HIGH, 'StaticAnalyzer')]);

    const hallInst = getMockInstance<{ detect: Mock }>(HallucinationDetector as unknown as Mock);
    hallInst.detect.mockResolvedValueOnce([makeFinding(Severity.MEDIUM, 'HallucinationDetector')]);

    const result = await pipeline.run(makeContext());

    expect(result.findings).toHaveLength(3);
    const detectors = result.findings.map((f) => f.detector);
    expect(detectors).toContain('AIPatternDetector');
    expect(detectors).toContain('StaticAnalyzer');
    expect(detectors).toContain('HallucinationDetector');
  });

  it('computes a non-zero riskScore when CRITICAL findings are present', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);

    const staticInst = getMockInstance<{ detect: Mock }>(StaticAnalyzer as unknown as Mock);
    staticInst.detect.mockResolvedValueOnce([
      makeFinding(Severity.CRITICAL),
      makeFinding(Severity.CRITICAL),
    ]);

    const result = await pipeline.run(makeContext());
    expect(result.riskScore).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Error isolation
// ===========================================================================

describe('AnalysisPipeline.run — error isolation', () => {
  it('records detector errors in result.errors with fatal: false', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);

    const staticInst = getMockInstance<{ detect: Mock }>(StaticAnalyzer as unknown as Mock);
    staticInst.detect.mockRejectedValueOnce(new Error('semgrep not found'));

    const result = await pipeline.run(makeContext());

    const staticError = result.errors.find((e) => e.detector === 'StaticAnalyzer');
    expect(staticError).toBeDefined();
    expect(staticError?.fatal).toBe(false);
    expect(staticError?.message).toContain('semgrep not found');
  });

  it('continues and scores remaining findings after a detector fails', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);

    const staticInst = getMockInstance<{ detect: Mock }>(StaticAnalyzer as unknown as Mock);
    staticInst.detect.mockRejectedValueOnce(new Error('crash'));

    // AIPatternDetector still succeeds with one CRITICAL finding
    const aiInst = getMockInstance<{ detect: Mock }>(AIPatternDetector as unknown as Mock);
    aiInst.detect.mockResolvedValueOnce({
      findings: [makeFinding(Severity.CRITICAL)],
      signatures: [],
    });

    const result = await pipeline.run(makeContext());

    expect(result.findings).toHaveLength(1);
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.detector === 'StaticAnalyzer')).toBe(true);
  });

  it('ExplanationEngine failure does not remove existing findings', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);

    const aiInst = getMockInstance<{ detect: Mock }>(AIPatternDetector as unknown as Mock);
    aiInst.detect.mockResolvedValueOnce({
      findings: [makeFinding(Severity.HIGH)],
      signatures: [],
    });

    const explainInst = getMockInstance<{ enrich: Mock }>(ExplanationEngine as unknown as Mock);
    explainInst.enrich.mockRejectedValueOnce(new Error('explanation service down'));

    const result = await pipeline.run(makeContext());

    // Finding still present despite ExplanationEngine failure
    expect(result.findings).toHaveLength(1);
    expect(result.errors.some((e) => e.message.includes('ExplanationEngine'))).toBe(true);
  });
});

// ===========================================================================
// AIPatternDetector always runs (regardless of feature flags)
// ===========================================================================

describe('AnalysisPipeline.run — AIPatternDetector always runs', () => {
  it('calls AIPatternDetector even when all other features are disabled', async () => {
    const pipeline = new AnalysisPipeline(PIPELINE_CONFIG);
    const aiInst = getMockInstance<{ detect: Mock }>(AIPatternDetector as unknown as Mock);

    const ctx = makeContext({
      features: {
        enableHallucinationDetection: false,
        enableAuthValidation: false,
        enableLogicBugDetection: false,
        enableSecretsScanning: false,
        enableStaticAnalysis: false,
        maxFilesPerScan: 50,
        maxLinesPerFile: 1_000,
      },
    });

    await pipeline.run(ctx);
    expect(aiInst.detect).toHaveBeenCalledOnce();
  });
});
