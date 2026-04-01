/**
 * AIPatternDetector
 *
 * Identifies code signatures commonly produced by AI coding assistants.
 * These signatures are used to:
 *  1. Classify other findings as "isAIPatternSpecific"
 *  2. Produce QUALITY-category findings for code health
 *
 * Detection is purely static (regex + AST heuristics) — no LLM call.
 */

import type { AnalysisFile, RawFinding, AIPatternSignature } from '@codesheriff/shared';
import { Severity, FindingCategory } from '@codesheriff/shared';
import { getScanLogger } from '../utils/logger.js';

interface PatternRule {
  name: string;
  description: string;
  /** Line-level test — returns true if the line matches */
  test: (line: string) => boolean;
  severity: Severity;
  /** Minimum confidence to emit a finding (0–1) */
  minConfidence: number;
}

// ---------------------------------------------------------------------------
// Heuristic pattern rules
// ---------------------------------------------------------------------------

const AI_PATTERN_RULES: PatternRule[] = [
  {
    name: 'Overly verbose variable name',
    description:
      'Extremely long variable names are an AI code signature — humans use shorter names.',
    test: (line) => {
      // Match identifiers longer than 35 chars that follow assignment/declaration patterns
      return /(?:const|let|var|function)\s+([a-zA-Z][a-zA-Z0-9_]{34,})\b/.test(line);
    },
    severity: Severity.INFO,
    minConfidence: 0.6,
  },
  {
    name: 'Obvious comment',
    description:
      'Comments explaining trivially obvious code are a hallmark of AI-generated output.',
    test: (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('//') && !trimmed.startsWith('#')) return false;
      const comment = trimmed.replace(/^\/\/\s*|^#\s*/, '').toLowerCase();
      const obviousPhrases = [
        'increment',
        'decrement',
        'return the',
        'initialize',
        'loop through',
        'iterate over',
        'check if',
        'set the',
        'get the',
        'convert to',
        'store the',
        'this function',
        'this method',
        'add 1',
        'subtract',
      ];
      return obviousPhrases.some((phrase) => comment.startsWith(phrase));
    },
    severity: Severity.INFO,
    minConfidence: 0.5,
  },
  {
    name: 'Inconsistent error handling',
    description:
      'try/catch present in some async paths but missing in others is an AI code pattern.',
    test: (line) => {
      // Detect awaited calls without try/catch context — rough heuristic
      return /^\s+await\s+\w+\(/.test(line) && !line.includes('try');
    },
    severity: Severity.LOW,
    minConfidence: 0.4,
  },
  {
    name: 'Dead code branch',
    description:
      'Authoritative-looking but unreachable code branches are common in AI output.',
    test: (line) => {
      return /if\s*\(\s*false\s*\)|if\s*\(\s*0\s*\)|if\s*\(\s*null\s*\)/.test(line);
    },
    severity: Severity.LOW,
    minConfidence: 0.9,
  },
  {
    name: 'Password comparison with == operator',
    description:
      'Non-constant-time password comparison is a critical auth anti-pattern in AI code.',
    test: (line) => {
      return /password\s*[=!]=\s*['"`]|['"`]\s*[=!]=\s*password/i.test(line) ||
        /\.password\s*===?\s*\w+/.test(line);
    },
    severity: Severity.CRITICAL,
    minConfidence: 0.85,
  },
  {
    name: 'API key in source code',
    description: 'Hardcoded credential detected — must be moved to environment variables.',
    test: (line) => {
      // Match common secret patterns: long alphanumeric strings assigned to key-looking vars
      // Deliberately conservative — TruffleHog handles the deep scan
      return /(?:apiKey|api_key|secret|token|password)\s*[:=]\s*['"`][A-Za-z0-9+/=_\-]{20,}['"`]/i.test(
        line
      ) && !line.includes('process.env') && !line.includes('os.environ');
    },
    severity: Severity.CRITICAL,
    minConfidence: 0.8,
  },
];

// ---------------------------------------------------------------------------
// Detector implementation
// ---------------------------------------------------------------------------

export class AIPatternDetector {
  /**
   * Scan all files for AI code signatures.
   *
   * @returns Array of raw findings + signatures for cross-detector classification
   */
  async detect(
    scanId: string,
    files: AnalysisFile[]
  ): Promise<{ findings: RawFinding[]; signatures: AIPatternSignature[] }> {
    const log = getScanLogger(scanId, 'AIPatternDetector');
    const findings: RawFinding[] = [];
    const signatures: AIPatternSignature[] = [];

    for (const file of files) {
      if (file.status === 'deleted') continue;
      // Skip binary files and overly long files
      if (file.lineCount > 5_000) {
        log.debug({ path: file.path }, 'skipping large file');
        continue;
      }

      const lines = file.content.split('\n');
      const fileFindingCount = { count: 0 };

      for (let i = 0; i < lines.length; i++) {
        const lineNumber = i + 1;
        const line = lines[i] ?? '';

        for (const rule of AI_PATTERN_RULES) {
          if (!rule.test(line)) continue;
          if (rule.minConfidence > 0.7) {
            // High-confidence patterns become explicit findings
            findings.push({
              ruleId: `ai-pattern:${rule.name.toLowerCase().replace(/\s+/g, '-')}`,
              title: rule.name,
              description: rule.description,
              severity: rule.severity,
              category: FindingCategory.QUALITY,
              filePath: file.path,
              lineStart: lineNumber,
              lineEnd: lineNumber,
              codeSnippet: line.trim().slice(0, 500),
              isAIPatternSpecific: true,
              detector: 'AIPatternDetector',
            });
            fileFindingCount.count++;
          }

          // Always record as a signature for cross-detector use
          signatures.push({
            name: rule.name,
            description: rule.description,
            confidence: rule.minConfidence,
            filePath: file.path,
            lineStart: lineNumber,
            lineEnd: lineNumber,
          });
        }

        // Cap findings per file to avoid noise from AI-generated boilerplate files
        if (fileFindingCount.count >= 20) break;
      }

      // Detect oversized functions (>100 lines without decomposition)
      const oversizedFunctions = detectOversizedFunctions(file, lines);
      findings.push(...oversizedFunctions);
    }

    log.info({ fileCount: files.length, findings: findings.length }, 'AIPatternDetector complete');
    return { findings, signatures };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect functions longer than 100 lines, which is a strong AI code signal.
 *
 * Uses a stack to correctly handle nested functions — each entry tracks the
 * start line and the brace depth at which it opened. A function closes when
 * the brace depth returns to the level recorded at its opening.
 *
 * Brace counting starts from the first '{' seen on or after the declaration
 * line, not from the declaration line itself. This handles multi-line
 * function signatures correctly.
 */
function detectOversizedFunctions(file: AnalysisFile, lines: string[]): RawFinding[] {
  const findings: RawFinding[] = [];

  // Stack entries: { startLine: number, openDepth: number }
  // openDepth = brace depth BEFORE the opening '{' of this function
  const stack: Array<{ startLine: number; openDepth: number }> = [];
  let braceDepth = 0;
  let pendingFunctionStart: number | null = null; // declaration seen, waiting for first '{'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNumber = i + 1;

    // Detect a top-level function declaration (at brace depth 0 only, to keep
    // the heuristic simple and avoid false positives inside class bodies)
    if (braceDepth === 0 && pendingFunctionStart === null) {
      const isFunctionDecl =
        /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\w+/.test(line) ||
        /^\s*(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\()/.test(line);

      if (isFunctionDecl) {
        pendingFunctionStart = lineNumber;
      }
    }

    // Count braces character by character on this line
    for (const char of line) {
      if (char === '{') {
        braceDepth++;
        // If we were waiting for the opening brace of a pending function, record it now
        if (pendingFunctionStart !== null) {
          stack.push({ startLine: pendingFunctionStart, openDepth: braceDepth - 1 });
          pendingFunctionStart = null;
        }
      } else if (char === '}') {
        braceDepth--;

        // Check if this closes the top function on the stack
        const top = stack[stack.length - 1];
        if (top !== undefined && braceDepth === top.openDepth) {
          stack.pop();
          const length = lineNumber - top.startLine;
          if (length > 100) {
            findings.push({
              ruleId: 'ai-pattern:oversized-function',
              title: 'Function exceeds 100 lines without decomposition',
              description: `Function starting at line ${top.startLine} is ${length} lines long. AI assistants commonly generate monolithic functions. Decompose into smaller, single-responsibility functions.`,
              severity: Severity.LOW,
              category: FindingCategory.QUALITY,
              filePath: file.path,
              lineStart: top.startLine,
              lineEnd: lineNumber,
              codeSnippet: `// Function spans lines ${top.startLine}–${lineNumber} (${length} lines)`,
              isAIPatternSpecific: true,
              detector: 'AIPatternDetector',
            });
          }
        }
      }
    }

    // Discard a pending declaration if we reach the next declaration without
    // ever finding a '{' (e.g., abstract method signatures in TS interfaces)
    if (pendingFunctionStart !== null && lineNumber > pendingFunctionStart + 5) {
      pendingFunctionStart = null;
    }
  }

  return findings;
}
