/**
 * CLI Pipeline Runner
 *
 * Wraps the @codesheriff/analyzer AnalysisPipeline for CLI usage:
 *   - Builds a synthetic AnalysisContext from local files
 *   - Uses MemoryRedis (no external Redis needed)
 *   - Reads ANTHROPIC_API_KEY from environment
 *   - Enables all detector stages (full scan by default)
 *   - Returns the PipelineResult for rendering
 */

import { randomUUID } from 'crypto';
import { AnalysisPipeline } from '@codesheriff/analyzer';
import type { AnalysisFile, AnalysisContext, PipelineResult } from '@codesheriff/shared';
import { MemoryRedis } from './mock-redis.js';

const DEFAULT_FEATURES = {
  enableHallucinationDetection: true,
  enableAuthValidation: true,
  enableLogicBugDetection: true,
  enableSecretsScanning: true,
  enableStaticAnalysis: true,
  maxFilesPerScan: 200,
  maxLinesPerFile: 2000,
};

export interface RunOptions {
  /** If true, skip LLM-based detectors (faster, no API key needed) */
  staticOnly?: boolean | undefined;
}

export async function runPipeline(
  files: AnalysisFile[],
  opts: RunOptions = {}
): Promise<PipelineResult> {
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';

  if (!apiKey && !opts.staticOnly) {
    // Gracefully downgrade to static-only if no API key
    opts = { ...opts, staticOnly: true };
    process.stderr.write(
      '\x1b[33m⚠  ANTHROPIC_API_KEY not set — running static analysis only (no LLM detectors).\n' +
        '   Set ANTHROPIC_API_KEY to enable hallucination detection, auth validation, and logic bug detection.\x1b[0m\n\n'
    );
  }

  const features = opts.staticOnly
    ? {
        ...DEFAULT_FEATURES,
        enableHallucinationDetection: false,
        enableAuthValidation: false,
        enableLogicBugDetection: false,
      }
    : DEFAULT_FEATURES;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const redis = new MemoryRedis() as unknown as any;
  const pipeline = new AnalysisPipeline({ anthropicApiKey: apiKey, redis });

  const ctx: AnalysisContext = {
    scanId: randomUUID(),
    repoFullName: 'local/scan',
    provider: 'github',
    branch: 'HEAD',
    commitSha: 'local',
    prNumber: null,
    files,
    dependencies: {},
    features,
  };

  return pipeline.run(ctx);
}
