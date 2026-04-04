/**
 * Bug Focus Filter
 *
 * Post-detector filter that classifies each finding as BUG or STYLE,
 * dropping STYLE findings to reduce false positives.
 *
 * Based on arxiv research showing this single change significantly reduces
 * noise in static analysis pipelines.
 */

import { FindingCategory, Severity } from '@codesheriff/shared';
import type { RawFinding } from '@codesheriff/shared';
import { getScanLogger } from '../utils/logger.js';

// Categories that are always bugs regardless of description
const BUG_CATEGORIES = new Set<FindingCategory>([
  FindingCategory.SECURITY,
  FindingCategory.AUTH,
  FindingCategory.SECRET,
  FindingCategory.HALLUCINATION,
  FindingCategory.LOGIC,
]);

// Keywords in title/description that elevate QUALITY findings to BUG
const BUG_QUALITY_KEYWORDS = [
  'null pointer',
  'null reference',
  'npe',
  'undefined access',
  'resource leak',
  'memory leak',
  'race condition',
  'deadlock',
  'data corruption',
  'data loss',
  'integer overflow',
  'buffer overflow',
  'injection',
  'xss',
  'csrf',
  'sql injection',
  'path traversal',
  'command injection',
  'insecure',
  'vulnerability',
  'cve',
  'exploit',
];

// Keywords in title/description that strongly indicate STYLE findings
const STYLE_KEYWORDS = [
  'should use',
  'prefer',
  'consider using',
  'code style',
  'formatting',
  'naming convention',
  'missing comment',
  'add documentation',
  'missing jsdoc',
  'indentation',
  'whitespace',
  'trailing',
  'unused variable',
  'unused import',
  'magic number',
  'extract method',
  'refactor',
  'simplify',
  'readability',
  'maintainability',
  'nitpick',
  'unnecessary',
  'redundant',
];

// "deprecated" is style unless it's a security issue
const DEPRECATED_SECURITY_RE = /deprecated.*(?:security|crypto|cipher|auth|ssl|tls|hash|encrypt)/i;

/**
 * Classify a single finding as BUG or STYLE.
 */
export function classifyFinding(finding: RawFinding): 'BUG' | 'STYLE' {
  // Always BUG: non-QUALITY categories
  if (BUG_CATEGORIES.has(finding.category)) {
    return 'BUG';
  }

  // Always BUG: CRITICAL severity
  if (finding.severity === Severity.CRITICAL) {
    return 'BUG';
  }

  // Always BUG: SecretsScanner detector
  if (finding.detector === 'SecretsScanner') {
    return 'BUG';
  }

  // For QUALITY category: check if it matches a BUG keyword
  if (finding.category === FindingCategory.QUALITY) {
    const text = `${finding.title} ${finding.description}`.toLowerCase();

    for (const kw of BUG_QUALITY_KEYWORDS) {
      if (text.includes(kw)) {
        return 'BUG';
      }
    }

    // Check style keywords
    for (const kw of STYLE_KEYWORDS) {
      if (text.includes(kw)) {
        return 'STYLE';
      }
    }

    // Check "deprecated" — style unless it's security-related
    if (text.includes('deprecated') && !DEPRECATED_SECURITY_RE.test(text)) {
      return 'STYLE';
    }

    // QUALITY finding with no matching keywords defaults to STYLE
    return 'STYLE';
  }

  // Any other category defaults to BUG
  return 'BUG';
}

export class BugFocusFilter {
  filter(findings: RawFinding[]): RawFinding[] {
    const log = getScanLogger('bug-focus-filter', 'BugFocusFilter');

    const kept: RawFinding[] = [];
    let droppedCount = 0;

    for (const finding of findings) {
      if (classifyFinding(finding) === 'BUG') {
        kept.push(finding);
      } else {
        droppedCount++;
      }
    }

    log.info(
      {
        total: findings.length,
        kept: kept.length,
        dropped: droppedCount,
      },
      'bug focus filter stats'
    );

    return kept;
  }
}
