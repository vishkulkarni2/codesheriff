/**
 * AuthFlowValidator
 *
 * Uses Claude to identify authentication and authorization vulnerabilities
 * in code that AI assistants commonly get wrong.
 *
 * Only analyzes files that are likely to contain auth logic (heuristic
 * filename/content filter to avoid spending LLM budget on unrelated files).
 */

import type { AnalysisFile, RawFinding, AuthFlowIssue } from '@codesheriff/shared';
import { Severity, FindingCategory } from '@codesheriff/shared';
import type { LlmClient } from '../llm/client.js';
import { AUTH_FLOW_SYSTEM_PROMPT, buildAuthFlowPrompt } from '../llm/prompts.js';
import { getScanLogger } from '../utils/logger.js';

/** File path patterns that suggest auth-related code */
const AUTH_FILE_PATTERNS = [
  /auth/i,
  /login/i,
  /session/i,
  /token/i,
  /middleware/i,
  /guard/i,
  /permission/i,
  /jwt/i,
  /oauth/i,
  /passport/i,
];

/** Content patterns that suggest a file contains auth code */
const AUTH_CONTENT_PATTERNS = [
  /jwt\./i,
  /bcrypt\./i,
  /passport\./i,
  /session\./i,
  /Bearer\s/,
  /Authorization:/i,
  /verif(y|ied)/i,
  /authenticate/i,
  /req\.user/i,
  /isAuthenticated/i,
];

export class AuthFlowValidator {
  constructor(private readonly llm: LlmClient) {}

  async detect(
    scanId: string,
    files: AnalysisFile[],
    repoContext: string
  ): Promise<RawFinding[]> {
    const log = getScanLogger(scanId, 'AuthFlowValidator');
    const findings: RawFinding[] = [];

    const authFiles = files.filter(
      (f) => f.status !== 'deleted' && isAuthRelated(f)
    );

    if (authFiles.length === 0) {
      log.debug('no auth-related files detected');
      return findings;
    }

    log.debug({ count: authFiles.length }, 'auth-related files identified');

    for (const file of authFiles) {
      try {
        const fileFindings = await this.analyzeFile(scanId, file, repoContext);
        findings.push(...fileFindings);
      } catch (err) {
        log.error({ err, path: file.path }, 'auth flow analysis failed for file');
      }
    }

    log.info(
      { fileCount: authFiles.length, findings: findings.length },
      'AuthFlowValidator complete'
    );
    return findings;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async analyzeFile(
    scanId: string,
    file: AnalysisFile,
    repoContext: string
  ): Promise<RawFinding[]> {
    const prompt = buildAuthFlowPrompt({
      code: file.content,
      context: repoContext,
    });

    const response = await this.llm.call({
      systemPrompt: AUTH_FLOW_SYSTEM_PROMPT,
      userPrompt: prompt,
      codeContent: file.content,
      detector: 'AuthFlowValidator',
    });

    const issues = parseAuthFlowResponse(response.content);
    return issues.map((issue) => this.toRawFinding(issue, file));
  }

  private toRawFinding(issue: AuthFlowIssue, file: AnalysisFile): RawFinding {
    const lines = file.content.split('\n');
    const lineIdx = Math.max(0, Math.min(issue.line - 1, lines.length - 1));
    const snippet = lines[lineIdx]?.trim().slice(0, 500) ?? '';

    const severity = mapSeverity(issue.severity);

    return {
      ruleId: `auth:${issue.cwe.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      title: issue.issue.split('.')[0] ?? issue.issue,
      description: issue.issue,
      severity,
      category: FindingCategory.AUTH,
      filePath: file.path,
      lineStart: issue.line,
      lineEnd: issue.line,
      codeSnippet: snippet,
      isAIPatternSpecific: true,
      detector: 'AuthFlowValidator',
      metadata: { cwe: issue.cwe },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAuthRelated(file: AnalysisFile): boolean {
  const pathMatch = AUTH_FILE_PATTERNS.some((p) => p.test(file.path));
  if (pathMatch) return true;

  // Check content for auth-related patterns (first 200 lines for speed)
  const preview = file.content.split('\n').slice(0, 200).join('\n');
  return AUTH_CONTENT_PATTERNS.some((p) => p.test(preview));
}

function mapSeverity(severity: string): Severity {
  switch (severity.toUpperCase()) {
    case 'CRITICAL':
      return Severity.CRITICAL;
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

function parseAuthFlowResponse(content: string): AuthFlowIssue[] {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isAuthFlowIssue);
  } catch {
    return [];
  }
}

function isAuthFlowIssue(v: unknown): v is AuthFlowIssue {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj['severity'] === 'string' &&
    typeof obj['issue'] === 'string' &&
    typeof obj['line'] === 'number' &&
    typeof obj['cwe'] === 'string'
  );
}
