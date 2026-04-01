/**
 * HallucinationDetector
 *
 * Uses Claude to identify hallucinated API calls — function names, methods,
 * or library usage that doesn't exist in the specified dependencies.
 *
 * Only runs on files with known dependencies and in supported languages.
 * Applies a confidence threshold to reduce false positives.
 */

import type { AnalysisFile, RawFinding, HallucinationMatch } from '@codesheriff/shared';
import { Severity, FindingCategory, PIPELINE_DEFAULTS } from '@codesheriff/shared';
import type { LlmClient } from '../llm/client.js';
import {
  HALLUCINATION_SYSTEM_PROMPT,
  buildHallucinationPrompt,
} from '../llm/prompts.js';
import { getScanLogger } from '../utils/logger.js';

/** Languages where hallucination detection is most reliable */
const SUPPORTED_LANGUAGES = new Set(['typescript', 'javascript', 'python']);

export class HallucinationDetector {
  constructor(private readonly llm: LlmClient) {}

  async detect(
    scanId: string,
    files: AnalysisFile[],
    dependencies: Record<string, string>
  ): Promise<RawFinding[]> {
    const log = getScanLogger(scanId, 'HallucinationDetector');
    const findings: RawFinding[] = [];

    const eligibleFiles = files.filter(
      (f) =>
        f.status !== 'deleted' &&
        SUPPORTED_LANGUAGES.has(f.language) &&
        f.lineCount <= 500 // Keep LLM input manageable
    );

    if (eligibleFiles.length === 0) {
      log.debug('no eligible files for hallucination detection');
      return findings;
    }

    for (const file of eligibleFiles) {
      try {
        const fileFindings = await this.analyzeFile(scanId, file, dependencies);
        findings.push(...fileFindings);
      } catch (err) {
        // Non-fatal — log and continue with remaining files
        log.error({ err, path: file.path }, 'hallucination detection failed for file');
      }
    }

    log.info(
      { fileCount: eligibleFiles.length, findings: findings.length },
      'HallucinationDetector complete'
    );
    return findings;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async analyzeFile(
    scanId: string,
    file: AnalysisFile,
    dependencies: Record<string, string>
  ): Promise<RawFinding[]> {
    const prompt = buildHallucinationPrompt({
      code: file.content,
      language: file.language,
      dependencies,
    });

    const response = await this.llm.call({
      systemPrompt: HALLUCINATION_SYSTEM_PROMPT,
      userPrompt: prompt,
      codeContent: file.content,
      detector: 'HallucinationDetector',
    });

    const matches = parseHallucinationResponse(response.content);

    return matches
      .filter((m) => m.confidence >= PIPELINE_DEFAULTS.HALLUCINATION_MIN_CONFIDENCE)
      .map((m) => this.toRawFinding(m, file));
  }

  private toRawFinding(match: HallucinationMatch, file: AnalysisFile): RawFinding {
    const lines = file.content.split('\n');
    // lineStart is 1-indexed from the LLM; clamp to valid range
    const lineIdx = Math.max(0, Math.min(match.line - 1, lines.length - 1));
    const snippet = lines[lineIdx]?.trim().slice(0, 500) ?? '';

    return {
      ruleId: 'hallucination:api-usage',
      title: `Hallucinated API: ${match.api}`,
      description: match.issue,
      severity: match.confidence >= 0.9 ? Severity.HIGH : Severity.MEDIUM,
      category: FindingCategory.HALLUCINATION,
      filePath: file.path,
      lineStart: match.line,
      lineEnd: match.line,
      codeSnippet: snippet,
      isAIPatternSpecific: true,
      detector: 'HallucinationDetector',
      metadata: { api: match.api, confidence: match.confidence },
    };
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseHallucinationResponse(content: string): HallucinationMatch[] {
  try {
    // Extract JSON array from response — LLM may wrap it in markdown
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isHallucinationMatch);
  } catch {
    return [];
  }
}

function isHallucinationMatch(v: unknown): v is HallucinationMatch {
  return (
    v !== null &&
    typeof v === 'object' &&
    'line' in v &&
    typeof (v as { line: unknown }).line === 'number' &&
    'api' in v &&
    typeof (v as { api: unknown }).api === 'string' &&
    'issue' in v &&
    typeof (v as { issue: unknown }).issue === 'string' &&
    'confidence' in v &&
    typeof (v as { confidence: unknown }).confidence === 'number'
  );
}
