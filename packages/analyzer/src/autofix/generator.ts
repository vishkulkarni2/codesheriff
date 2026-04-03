/**
 * AutoFixGenerator — Stage 9 of the analysis pipeline.
 *
 * For each HIGH or CRITICAL finding (up to 10 per scan), calls Claude
 * with the flagged code and surrounding context to produce a concrete,
 * minimal fix in GitHub suggestion format.
 *
 * Results are attached to the finding in-place (`finding.autoFix`).
 * All errors are non-fatal: a generation failure never blocks the pipeline.
 */

import type { AutoFix, RawFinding, AnalysisFile } from '@codesheriff/shared';
import { Severity } from '@codesheriff/shared';
import type { LlmClient } from '../llm/client.js';
import { AUTOFIX_SYSTEM_PROMPT, buildAutoFixPrompt } from '../llm/prompts.js';
import { getScanLogger } from '../utils/logger.js';

/** Severities that qualify for auto-fix generation */
const ELIGIBLE_SEVERITIES = new Set<Severity>([Severity.HIGH, Severity.CRITICAL]);

/** Maximum findings to fix per scan (LLM cost control) */
const MAX_FIXES_PER_SCAN = 10;

/** Lines of surrounding context to include above/below the flagged range */
const CONTEXT_LINES = 5;

/** Minimum valid confidence value from the model */
const CONFIDENCE_MIN = 0.0;
/** Maximum valid confidence value from the model */
const CONFIDENCE_MAX = 1.0;

interface AutoFixRawResponse {
  suggestedCode?: unknown;
  explanation?: unknown;
  confidence?: unknown;
  cannot_fix?: unknown;
  reason?: unknown;
}

export class AutoFixGenerator {
  constructor(private readonly llm: LlmClient) {}

  /**
   * Generate a fix for a single finding.
   * Returns null when the finding is ineligible, Claude can't fix it, or
   * the response fails validation. Never throws.
   */
  async generate(
    scanId: string,
    finding: RawFinding,
    fileContent: string,
    language: string
  ): Promise<AutoFix | null> {
    const log = getScanLogger(scanId, 'AutoFixGenerator');

    if (!ELIGIBLE_SEVERITIES.has(finding.severity)) {
      return null;
    }

    const lines = fileContent.split('\n');
    const totalLines = lines.length;

    // Extract surrounding context (±CONTEXT_LINES), clamped to file bounds
    const contextStart = Math.max(0, finding.lineStart - 1 - CONTEXT_LINES);
    const contextEnd = Math.min(totalLines, finding.lineEnd + CONTEXT_LINES);
    const surroundingContext = lines.slice(contextStart, contextEnd).join('\n');

    const prompt = buildAutoFixPrompt({
      title: finding.title,
      description: finding.description,
      severity: finding.severity,
      filePath: finding.filePath,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
      codeSnippet: finding.codeSnippet,
      surroundingContext,
      language,
    });

    try {
      const response = await this.llm.call({
        systemPrompt: AUTOFIX_SYSTEM_PROMPT,
        userPrompt: prompt,
        codeContent: surroundingContext,
        detector: 'AutoFixGenerator',
      });

      const parsed = parseAutoFixResponse(response.content);
      if (parsed === null) {
        log.debug(
          { filePath: finding.filePath, lineStart: finding.lineStart },
          'autofix: model returned cannot_fix or invalid response'
        );
        return null;
      }

      // Clamp confidence to valid range
      const confidence = Math.min(
        CONFIDENCE_MAX,
        Math.max(CONFIDENCE_MIN, parsed.confidence)
      );

      const fix: AutoFix = {
        suggestedCode: parsed.suggestedCode,
        explanation: parsed.explanation,
        confidence,
        lineStart: finding.lineStart,
        lineEnd: finding.lineEnd,
      };

      log.debug(
        {
          filePath: finding.filePath,
          lineStart: finding.lineStart,
          confidence: fix.confidence,
          cached: response.cached,
        },
        'autofix generated'
      );

      return fix;
    } catch (err) {
      log.warn(
        { err, filePath: finding.filePath, lineStart: finding.lineStart },
        'autofix generation failed — skipping finding'
      );
      return null;
    }
  }

  /**
   * Generate fixes for all eligible findings in a scan batch.
   * Mutates each finding's `autoFix` field in place.
   * Runs serially to control LLM cost. Never throws.
   */
  async generateBatch(
    scanId: string,
    findings: RawFinding[],
    files: AnalysisFile[]
  ): Promise<void> {
    const log = getScanLogger(scanId, 'AutoFixGenerator');

    const eligible = findings
      .filter((f) => ELIGIBLE_SEVERITIES.has(f.severity))
      .slice(0, MAX_FIXES_PER_SCAN);

    if (eligible.length === 0) {
      log.debug('no eligible findings for autofix');
      return;
    }

    log.debug({ count: eligible.length }, 'starting autofix batch');

    // Build a quick lookup map: filePath → AnalysisFile
    const fileMap = new Map<string, AnalysisFile>(
      files.map((f) => [f.path, f])
    );

    let generated = 0;

    for (const finding of eligible) {
      const file = fileMap.get(finding.filePath);
      if (!file || file.status === 'deleted') {
        log.debug({ filePath: finding.filePath }, 'autofix: file not found or deleted — skipping');
        continue;
      }

      try {
        const fix = await this.generate(scanId, finding, file.content, file.language);
        if (fix !== null) {
          finding.autoFix = fix;
          generated++;
        }
      } catch (err) {
        // Belt-and-suspenders catch — generate() already catches internally
        log.warn({ err, filePath: finding.filePath }, 'autofix: unexpected error in batch loop');
      }
    }

    log.info(
      { eligible: eligible.length, generated },
      'autofix batch complete'
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse and validate the raw JSON response from Claude.
 * Returns null when the response indicates cannot_fix or fails validation.
 */
function parseAutoFixResponse(
  raw: string
): { suggestedCode: string; explanation: string; confidence: number } | null {
  let parsed: AutoFixRawResponse;
  try {
    parsed = JSON.parse(raw) as AutoFixRawResponse;
  } catch {
    return null;
  }

  // Model indicated it cannot produce a safe fix
  if (parsed.cannot_fix === true) {
    return null;
  }

  const { suggestedCode, explanation, confidence } = parsed;

  if (
    typeof suggestedCode !== 'string' ||
    typeof explanation !== 'string' ||
    typeof confidence !== 'number'
  ) {
    return null;
  }

  if (suggestedCode.trim().length === 0 || explanation.trim().length === 0) {
    return null;
  }

  return { suggestedCode, explanation, confidence };
}
