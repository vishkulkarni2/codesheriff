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

  private async analyzeFile(scanId: string, file: AnalysisFile): Promise<RawFinding[]> {
    const functionContext = extractFunctionNames(file.content);

    const prompt = buildLogicBugPrompt({
      code: file.content,
      language: file.language,
      functionContext,
    });

    const response = await this.llm.call({
      systemPrompt: LOGIC_BUG_SYSTEM_PROMPT,
      userPrompt: prompt,
      codeContent: file.content,
      detector: 'LogicBugDetector',
    });

    const bugs = parseLogicBugResponse(response.content);
    return bugs.map((bug) => this.toRawFinding(bug, file));
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

    return parsed.filter(isLogicBug);
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
