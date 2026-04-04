/**
 * Output renderer for CodeSheriff CLI findings.
 *
 * Supports two output modes:
 *   - Terminal: colored, human-readable output with severity badges
 *   - JSON: machine-readable, suitable for CI/CD integration (--json flag)
 */

import chalk from 'chalk';
import type { RawFinding, PipelineResult } from '@codesheriff/shared';
import { Severity } from '@codesheriff/shared';

export interface RenderOptions {
  json?: boolean | undefined;
  fix?: boolean | undefined;
  /** Path that was scanned (for display) */
  target: string;
}

export interface JsonOutput {
  target: string;
  riskScore: number;
  findingsCount: number;
  durationMs: number;
  findings: JsonFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  passed: boolean;
}

interface JsonFinding {
  ruleId: string | null;
  title: string;
  description: string;
  severity: string;
  category: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  codeSnippet: string;
  detector: string;
  fix?: string;
}


/** Deduplicate findings by (file, line, category) */
function deduplicateFindings(findings: RawFinding[]): RawFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.filePath}:${f.lineStart}:${f.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderResults(result: PipelineResult, opts: RenderOptions): void {
  // Deduplicate findings before rendering
  result = { ...result, findings: deduplicateFindings(result.findings) };

  if (opts.json) {
    renderJson(result, opts);
  } else {
    renderTerminal(result, opts);
  }
}

export function renderError(message: string, json: boolean): void {
  if (json) {
    process.stderr.write(JSON.stringify({ error: message }) + '\n');
  } else {
    console.error(chalk.red(`\n✗ Error: ${message}\n`));
  }
}

// ---------------------------------------------------------------------------
// Terminal renderer
// ---------------------------------------------------------------------------

function renderTerminal(result: PipelineResult, opts: RenderOptions): void {
  const { findings, riskScore, durationMs } = result;

  // Header
  console.log('');
  console.log(chalk.bold('CodeSheriff') + chalk.dim(' · AI Code Safety Scanner'));
  console.log(chalk.dim(`Target: ${opts.target}`));
  console.log('');

  if (findings.length === 0) {
    console.log(chalk.green('✓ No findings. Looking clean.'));
    console.log('');
    renderSummaryLine(result);
    return;
  }

  // Group findings by severity for ordered display
  const bySeverity = groupBySeverity(findings);
  const order: Severity[] = [
    Severity.CRITICAL,
    Severity.HIGH,
    Severity.MEDIUM,
    Severity.LOW,
    Severity.INFO,
  ];

  for (const severity of order) {
    const group = bySeverity[severity];
    if (!group || group.length === 0) continue;

    console.log(severityHeader(severity, group.length));

    for (const finding of group) {
      renderFinding(finding, opts.fix ?? false);
    }
  }

  renderSummaryLine(result);
  renderRiskScore(riskScore);

  if (opts.fix) {
    console.log('');
    console.log(chalk.dim('──────────────────────────────────────────'));
    console.log(chalk.bold.yellow('⚠  --fix mode: suggested fixes printed above.'));
    console.log(chalk.dim('   Auto-apply is not yet implemented. Review and apply manually.'));
  }

  console.log('');
  console.log(chalk.dim(`Scan completed in ${durationMs}ms`));
  console.log('');
}

function renderFinding(finding: RawFinding, showFix: boolean): void {
  const badge = severityBadge(finding.severity);
  const location = chalk.cyan(`${finding.filePath}`) + chalk.dim(`:${finding.lineStart}`);

  console.log(`  ${badge} ${chalk.bold(finding.title)}`);
  console.log(`       ${location}`);
  console.log(`       ${chalk.dim(finding.description)}`);

  if (finding.codeSnippet) {
    const snippet = finding.codeSnippet
      .split('\n')
      .slice(0, 4)
      .map((l) => `         ${chalk.dim('│')} ${chalk.gray(l)}`)
      .join('\n');
    console.log(snippet);
  }

  // Show fix if --fix flag AND explanation/remediation exists on the finding
  if (showFix) {
    const enriched = finding as RawFinding & { remediation?: string };
    if (enriched.remediation) {
      console.log(`       ${chalk.green('Fix:')} ${enriched.remediation.split('\n')[0]}`);
    } else {
      console.log(`       ${chalk.green('Fix:')} ${chalk.dim('No automated fix available — review manually.')}`);
    }
  }

  console.log('');
}

function renderSummaryLine(result: PipelineResult): void {
  const { findings } = result;
  const counts = countBySeverity(findings);

  const parts: string[] = [];
  if (counts[Severity.CRITICAL] > 0) parts.push(chalk.red.bold(`${counts[Severity.CRITICAL]} critical`));
  if (counts[Severity.HIGH] > 0) parts.push(chalk.redBright(`${counts[Severity.HIGH]} high`));
  if (counts[Severity.MEDIUM] > 0) parts.push(chalk.yellow(`${counts[Severity.MEDIUM]} medium`));
  if (counts[Severity.LOW] > 0) parts.push(chalk.blue(`${counts[Severity.LOW]} low`));
  if (counts[Severity.INFO] > 0) parts.push(chalk.dim(`${counts[Severity.INFO]} info`));

  if (parts.length === 0) {
    console.log(chalk.dim('Summary: 0 findings'));
  } else {
    console.log(chalk.bold('Summary: ') + parts.join(chalk.dim(' · ')));
  }
}

function renderRiskScore(score: number): void {
  const bar = buildScoreBar(score);
  const color = score >= 70 ? chalk.red : score >= 40 ? chalk.yellow : chalk.green;

  console.log('');
  console.log(chalk.bold('Risk Score: ') + color.bold(`${score}/100`) + '  ' + bar);
}

function buildScoreBar(score: number): string {
  const width = 20;
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const color = score >= 70 ? chalk.red : score >= 40 ? chalk.yellow : chalk.green;
  return color('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}

// ---------------------------------------------------------------------------
// JSON renderer
// ---------------------------------------------------------------------------

function renderJson(result: PipelineResult, opts: RenderOptions): void {
  const counts = countBySeverity(result.findings);

  const output: JsonOutput = {
    target: opts.target,
    riskScore: result.riskScore,
    findingsCount: result.findings.length,
    durationMs: result.durationMs,
    findings: result.findings.map((f) => {
      const enriched = f as RawFinding & { remediation?: string };
      const finding: JsonFinding = {
        ruleId: f.ruleId,
        title: f.title,
        description: f.description,
        severity: f.severity,
        category: f.category,
        file: f.filePath,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
        codeSnippet: f.codeSnippet,
        detector: f.detector,
      };
      if (opts.fix && enriched.remediation) {
        finding.fix = enriched.remediation;
      }
      return finding;
    }),
    summary: {
      critical: counts[Severity.CRITICAL],
      high: counts[Severity.HIGH],
      medium: counts[Severity.MEDIUM],
      low: counts[Severity.LOW],
      info: counts[Severity.INFO],
    },
    passed: result.riskScore < 50 && counts[Severity.CRITICAL] === 0,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

function severityBadge(severity: Severity): string {
  switch (severity) {
    case Severity.CRITICAL:
      return chalk.bgRed.white.bold(' CRITICAL ');
    case Severity.HIGH:
      return chalk.bgRedBright.white.bold('   HIGH   ');
    case Severity.MEDIUM:
      return chalk.bgYellow.black.bold('  MEDIUM  ');
    case Severity.LOW:
      return chalk.bgBlue.white.bold('   LOW    ');
    case Severity.INFO:
      return chalk.bgGray.white.bold('   INFO   ');
  }
}

function severityHeader(severity: Severity, count: number): string {
  const line = '──────────────────────────────────────────';
  switch (severity) {
    case Severity.CRITICAL:
      return chalk.red.bold(`\n${line}\n  🚨 CRITICAL  (${count})\n${line}`);
    case Severity.HIGH:
      return chalk.redBright(`\n${line}\n  ⛔ HIGH  (${count})\n${line}`);
    case Severity.MEDIUM:
      return chalk.yellow(`\n${line}\n  ⚠️  MEDIUM  (${count})\n${line}`);
    case Severity.LOW:
      return chalk.blue(`\n${line}\n  ℹ️  LOW  (${count})\n${line}`);
    case Severity.INFO:
      return chalk.dim(`\n${line}\n  · INFO  (${count})\n${line}`);
  }
}

function groupBySeverity(findings: RawFinding[]): Record<Severity, RawFinding[]> {
  return findings.reduce(
    (acc, f) => {
      if (!acc[f.severity]) acc[f.severity] = [];
      acc[f.severity]!.push(f);
      return acc;
    },
    {} as Record<Severity, RawFinding[]>
  );
}

function countBySeverity(findings: RawFinding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    [Severity.CRITICAL]: 0,
    [Severity.HIGH]: 0,
    [Severity.MEDIUM]: 0,
    [Severity.LOW]: 0,
    [Severity.INFO]: 0,
  };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}
