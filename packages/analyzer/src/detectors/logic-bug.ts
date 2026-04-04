/**
 * LogicBugDetector
 *
 * Uses Claude to find subtle logic errors in code — off-by-one errors,
 * race conditions, incorrect null handling, type coercion bugs.
 *
 * Only analyzes files that changed significantly (>5 lines diff) to
 * focus budget on newly introduced code rather than stable existing logic.
 */

import type { AnalysisFile, RawFinding, LogicBug } from '@codesheriff/shared';
import { Severity, FindingCategory } from '@codesheriff/shared';
import type { LlmClient } from '../llm/client.js';
import { LOGIC_BUG_SYSTEM_PROMPT, buildLogicBugPrompt } from '../llm/prompts.js';
import { getScanLogger } from '../utils/logger.js';

/** File types to analyze — compiled outputs and lock files are skipped */
const SKIP_EXTENSIONS = new Set([
  '.lock', '.min.js', '.min.css', '.map',
  '.png', '.jpg', '.svg', '.ico', '.woff', '.woff2',
  '.d.ts', // Type declaration files rarely contain logic bugs
]);

/**
 * Multi-review aggregation configuration.
 * Based on arxiv research showing 3-run consensus dramatically improves precision.
 * A finding must appear in at least MIN_AGREEMENT_RUNS out of TOTAL_RUNS to be kept.
 */
const TOTAL_RUNS = 3;
const MIN_AGREEMENT_RUNS = 2; // 2-of-3 consensus required

/** Normalize a bug description for cross-run deduplication.
 *  Strips punctuation, lowercases, and extracts the first 8 words so that
 *  minor LLM paraphrasing still matches across runs. */
function normalizeBugKey(bug: LogicBug, filePath: string): string {
  const words = bug.bug
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(' ');
  // Include line number (±2 tolerance applied at aggregation time) and file
  return `${filePath}:${bug.line}:${words}`;
}

/** Check if two bug keys are close enough to be the same finding.
 *  Allows ±2 line number drift between runs. */
function bugKeysMatch(keyA: string, keyB: string): boolean {
  if (keyA === keyB) return true;
  // Parse: filePath:line:words
  const partsA = keyA.split(':');
  const partsB = keyB.split(':');
  if (partsA.length < 3 || partsB.length < 3) return false;
  const fileA = partsA[0];
  const fileB = partsB[0];
  if (fileA !== fileB) return false;
  const lineA = parseInt(partsA[1] ?? '0', 10);
  const lineB = parseInt(partsB[1] ?? '0', 10);
  if (Math.abs(lineA - lineB) > 2) return false;
  // Words segment (everything after second colon)
  const wordsA = partsA.slice(2).join(':');
  const wordsB = partsB.slice(2).join(':');
  return wordsA === wordsB;
}

export class LogicBugDetector {
  constructor(private readonly llm: LlmClient) {}

  async detect(scanId: string, files: AnalysisFile[]): Promise<RawFinding[]> {
    const log = getScanLogger(scanId, 'LogicBugDetector');
    const findings: RawFinding[] = [];

    const eligibleFiles = files.filter(
      (f) =>
        f.status !== 'deleted' &&
        !hasSkippedExtension(f.path) &&
        f.lineCount <= 400 && // Focus on reasonably sized files
        (f.patch == null || countDiffLines(f.patch) >= 5) // Only significantly changed files
    );

    if (eligibleFiles.length === 0) {
      log.debug('no eligible files for logic bug detection');
      return findings;
    }

    for (const file of eligibleFiles) {
      try {
        const fileFindings = await this.analyzeFile(scanId, file);
        findings.push(...fileFindings);
      } catch (err) {
        log.error({ err, path: file.path }, 'logic bug detection failed for file');
      }
    }

    log.info(
      { fileCount: eligibleFiles.length, findings: findings.length },
      'LogicBugDetector complete'
    );
    return findings;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Run TOTAL_RUNS independent LLM calls on the same file, then aggregate.
   * Only findings that appear in at least MIN_AGREEMENT_RUNS runs are kept.
   * This implements the multi-review aggregation technique from arxiv research
   * that dramatically improves precision by filtering LLM hallucinations.
   */
  private async analyzeFile(scanId: string, file: AnalysisFile): Promise<RawFinding[]> {
    const log = getScanLogger(scanId, 'LogicBugDetector');
    const functionContext = extractFunctionNames(file.content);

    const prompt = buildLogicBugPrompt({
      code: file.content,
      language: file.language,
      functionContext,
    });

    // Run TOTAL_RUNS independent LLM calls in parallel
    const runResults = await Promise.allSettled(
      Array.from({ length: TOTAL_RUNS }, () =>
        this.llm.call({
          systemPrompt: LOGIC_BUG_SYSTEM_PROMPT,
          userPrompt: prompt,
          codeContent: file.content,
          detector: 'LogicBugDetector',
        })
      )
    );

    // Collect all bugs from successful runs, tagged with which run they came from
    const allRunBugs: Array<{ bug: LogicBug; runIndex: number }> = [];
    let successfulRuns = 0;

    for (let i = 0; i < runResults.length; i++) {
      const result = runResults[i];
      if (result && result.status === 'fulfilled') {
        const bugs = parseLogicBugResponse(result.value.content);
        for (const bug of bugs) {
          allRunBugs.push({ bug, runIndex: i });
        }
        successfulRuns++;
      } else if (result) {
        log.warn({ runIndex: i, err: String(result.reason) }, 'Logic bug run failed — skipping');
      }
    }

    // Need at least MIN_AGREEMENT_RUNS successful runs for consensus to be meaningful
    if (successfulRuns < MIN_AGREEMENT_RUNS) {
      log.warn(
        { successfulRuns, file: file.path },
        'Too few successful runs for consensus — returning no findings'
      );
      return [];
    }

    // Aggregate: count how many runs each finding appeared in
    // Use normalized bug keys with line-drift tolerance for cross-run matching
    const bugRunCounts = new Map<string, { bug: LogicBug; runCount: number; canonicalKey: string }>();

    for (const { bug } of allRunBugs) {
      const key = normalizeBugKey(bug, file.path);

      // Check if any existing key matches (with drift tolerance)
      let matchedKey: string | undefined;
      for (const existingKey of bugRunCounts.keys()) {
        if (bugKeysMatch(key, existingKey)) {
          matchedKey = existingKey;
          break;
        }
      }

      if (matchedKey !== undefined) {
        const entry = bugRunCounts.get(matchedKey)!;
        entry.runCount++;
        // Keep the highest-confidence version of the bug description
        if ((bug.confidence ?? 0) > ((entry.bug as { confidence?: number }).confidence ?? 0)) {
          entry.bug = bug;
        }
      } else {
        bugRunCounts.set(key, { bug, runCount: 1, canonicalKey: key });
      }
    }

    // Keep only findings that appeared in MIN_AGREEMENT_RUNS or more runs
    const consensusFindings: LogicBug[] = [];
    for (const { bug, runCount } of bugRunCounts.values()) {
      if (runCount >= MIN_AGREEMENT_RUNS) {
        consensusFindings.push(bug);
      }
    }

    log.debug(
      {
        file: file.path,
        totalRuns: TOTAL_RUNS,
        successfulRuns,
        totalCandidates: allRunBugs.length,
        afterConsensus: consensusFindings.length,
        minAgreement: MIN_AGREEMENT_RUNS,
      },
      'Multi-run consensus aggregation complete'
    );

    return consensusFindings.map((bug) => this.toRawFinding(bug, file));
  }

  private toRawFinding(bug: LogicBug, file: AnalysisFile): RawFinding {
    const lines = file.content.split('\n');
    const lineIdx = Math.max(0, Math.min(bug.line - 1, lines.length - 1));
    const snippet = lines[lineIdx]?.trim().slice(0, 500) ?? '';

    return {
      ruleId: 'logic:ai-generated-bug',
      title: bug.bug.split('.')[0]?.trim() ?? 'Logic bug detected',
      description: bug.bug,
      severity: mapSeverity(bug.severity),
      category: FindingCategory.LOGIC,
      filePath: file.path,
      lineStart: bug.line,
      lineEnd: bug.line,
      codeSnippet: snippet,
      isAIPatternSpecific: true,
      detector: 'LogicBugDetector',
      metadata: { fix: bug.fix },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasSkippedExtension(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.'));
  return SKIP_EXTENSIONS.has(ext);
}

function countDiffLines(patch: string): number {
  return patch.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-')).length;
}

/**
 * Extract top-level function names from file content for context.
 * Gives the LLM better understanding of what the code is doing.
 */
function extractFunctionNames(content: string): string {
  const names: string[] = [];
  const patterns = [
    /(?:async\s+)?function\s+(\w+)/g,
    /(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g,
    /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (name !== undefined) names.push(name);
      if (names.length >= 20) break; // Cap to avoid prompt bloat
    }
  }

  return [...new Set(names)].join(', ');
}

function mapSeverity(severity: string): Severity {
  switch (severity.toUpperCase()) {
    case 'HIGH':
      return Severity.HIGH;
    case 'MEDIUM':
      return Severity.MEDIUM;
    case 'LOW':
      return Severity.LOW;
    default:
      return Severity.MEDIUM;
  }
}

function parseLogicBugResponse(content: string): LogicBug[] {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isLogicBug).filter((bug) => {
      const b = bug as { confidence?: unknown };
      if (typeof b.confidence === 'number') {
        // Raised from 0.7 → 0.8 to match the stricter prompt minimum
        return b.confidence >= 0.8;
      }
      // If confidence not present, keep it (older prompt compat)
      return true;
    });
  } catch {
    return [];
  }
}

function isLogicBug(v: unknown): v is LogicBug {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj['line'] === 'number' &&
    typeof obj['bug'] === 'string' &&
    typeof obj['severity'] === 'string' &&
    typeof obj['fix'] === 'string'
  );
}
