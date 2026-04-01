/**
 * PR Comment Builder
 *
 * Formats the CodeSheriff risk score card and finding summaries
 * for posting as GitHub PR comments.
 */

import type { RawFinding } from '@codesheriff/shared';
import { Severity, getRiskLevel } from '@codesheriff/shared';

const RISK_EMOJI: Record<string, string> = {
  low: '🟢',
  medium: '🟡',
  high: '🟠',
  critical: '🔴',
};

const SEVERITY_EMOJI: Record<Severity, string> = {
  [Severity.CRITICAL]: '🔴',
  [Severity.HIGH]: '🟠',
  [Severity.MEDIUM]: '🟡',
  [Severity.LOW]: '🟢',
  [Severity.INFO]: 'ℹ️',
};

/**
 * Build the PR summary comment with risk score card.
 */
export function buildPRSummaryComment(params: {
  riskScore: number;
  scanId: string;
  findings: RawFinding[];
  apiUrl: string;
  repoFullName: string;
}): string {
  const { riskScore, scanId, findings, apiUrl, repoFullName } = params;

  const level = getRiskLevel(riskScore);
  const riskEmoji = RISK_EMOJI[level] ?? '⚪';
  const riskLabel =
    level === 'critical' ? 'Critical Risk'
    : level === 'high' ? 'High Risk'
    : level === 'medium' ? 'Medium Risk'
    : 'Low Risk';

  const counts = countBySeverity(findings);

  const criticalFindings = findings
    .filter((f) => f.severity === Severity.CRITICAL || f.severity === Severity.HIGH)
    .slice(0, 5);

  const criticalList =
    criticalFindings.length > 0
      ? criticalFindings
          .map(
            (f) =>
              `- **${f.title}** (\`${f.filePath}:${f.lineStart}\`) — [View →](${apiUrl}/scans/${scanId}#${f.filePath})`
          )
          .join('\n')
      : '_No critical or high findings._';

  return `## CodeSheriff Analysis 🔍

**Risk Score: ${riskScore}/100** ${riskEmoji} ${riskLabel}

| Severity | Count |
|----------|-------|
| 🔴 Critical | ${counts.critical} |
| 🟠 High | ${counts.high} |
| 🟡 Medium | ${counts.medium} |
| 🟢 Low | ${counts.low} |

### Critical & High Findings
${criticalList}

> Powered by CodeSheriff · [Full Report](${apiUrl}/scans/${scanId})`;
}

/**
 * Build an inline review comment for a single finding.
 */
export function buildInlineComment(finding: RawFinding): string {
  const emoji = SEVERITY_EMOJI[finding.severity] ?? '⚠️';
  const lines: string[] = [
    `${emoji} **CodeSheriff: ${finding.title}**`,
    '',
    finding.description,
  ];

  const withExplanation = finding as RawFinding & {
    explanation?: string;
    remediation?: string;
  };

  if (withExplanation.explanation) {
    lines.push('', '**Why this matters:**', withExplanation.explanation);
  }

  if (withExplanation.remediation) {
    lines.push('', '**Suggested fix:**', '```', withExplanation.remediation, '```');
  }

  if (finding.isAIPatternSpecific) {
    lines.push('', '_⚠️ This pattern is commonly introduced by AI coding assistants._');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countBySeverity(
  findings: RawFinding[]
): Record<'critical' | 'high' | 'medium' | 'low', number> {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (f.severity === Severity.CRITICAL) counts.critical++;
    else if (f.severity === Severity.HIGH) counts.high++;
    else if (f.severity === Severity.MEDIUM) counts.medium++;
    else if (f.severity === Severity.LOW) counts.low++;
  }
  return counts;
}
