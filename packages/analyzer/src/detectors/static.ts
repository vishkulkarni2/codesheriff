/**
 * StaticAnalyzer
 *
 * Wraps the semgrep CLI to run both the global CodeSheriff custom rules
 * and any org-specific custom rules. Produces structured findings from
 * semgrep's JSON output.
 *
 * SECURITY:
 *   - semgrep is invoked with shell: false (via runSubprocess)
 *   - Rule files are from a trusted directory — never user-controlled paths
 *   - File paths passed to semgrep are validated against the expected tmpdir
 */

import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, dirname, resolve, relative as pathRelative } from 'node:path';
import { tmpdir } from 'node:os';
import type { AnalysisFile, RawFinding, SemgrepResult } from '@codesheriff/shared';
import { Severity, FindingCategory } from '@codesheriff/shared';
import { runSubprocess } from '../utils/subprocess.js';
import { getScanLogger } from '../utils/logger.js';
import { PIPELINE_DEFAULTS } from '@codesheriff/shared';

// Path to CodeSheriff's built-in semgrep rules directory.
// Resolution order:
//   1. SEMGREP_RULES_DIR env var (deployments may pin a specific path)
//   2. /app/rules — production runner image bundles rules here
//   3. Relative walk from this source file (dev / monorepo build)
// Falling back gracefully avoids the silent-no-rules failure mode where
// semgrep runs against an empty config and returns zero findings.
import { existsSync } from 'node:fs';
function resolveRulesDir(): string {
  const fromEnv = process.env['SEMGREP_RULES_DIR'];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync('/app/rules')) return '/app/rules';
  // Walk up from this file looking for a sibling rules/ directory
  // (handles both src/ during dev and dist/ after build)
  const here = new URL('.', import.meta.url).pathname;
  for (let depth = 0; depth < 8; depth++) {
    const candidate = resolve(here, '../'.repeat(depth), 'rules');
    if (existsSync(candidate)) return candidate;
  }
  // Last resort — return the original relative guess so semgrep errors loudly
  return resolve(new URL('../../../../rules', import.meta.url).pathname);
}
const BUILTIN_RULES_DIR = resolveRulesDir();

const SEVERITY_MAP: Record<string, Severity> = {
  ERROR: Severity.CRITICAL,
  WARNING: Severity.HIGH,
  INFO: Severity.MEDIUM,
  NOTE: Severity.LOW,
};

const CATEGORY_KEYWORDS: [RegExp, FindingCategory][] = [
  [/auth|jwt|role|session|permission|csrf/i, FindingCategory.AUTH],
  [/secret|credential|api.?key|token/i, FindingCategory.SECRET],
  [/sql|inject|xss|cors|idor/i, FindingCategory.SECURITY],
  [/race|async|concurrent/i, FindingCategory.LOGIC],
];

export class StaticAnalyzer {
  /**
   * Run semgrep on the provided files using built-in + custom org rules.
   *
   * @param customRuleYaml - Optional additional YAML rule content (org-specific)
   */
  async detect(
    scanId: string,
    files: AnalysisFile[],
    customRuleYaml?: string
  ): Promise<RawFinding[]> {
    const log = getScanLogger(scanId, 'StaticAnalyzer');

    const activeFiles = files.filter((f) => f.status !== 'deleted');
    if (activeFiles.length === 0) return [];

    const tmpDir = await mkdtemp(join(tmpdir(), 'codesheriff-semgrep-'));

    try {
      await this.writeFilesToTmp(tmpDir, activeFiles);

      // Build semgrep args — rules dir is trusted, never user-controlled
      const args = [
        '--json',
        '--no-git-ignore',
        '--metrics=off',
        `--config=${BUILTIN_RULES_DIR}`,
      ];

      // If org has custom rules, write them to a temp file and add to config
      if (customRuleYaml) {
        const customRulesPath = join(tmpDir, '__custom_rules__.yaml');
        await writeFile(customRulesPath, customRuleYaml, 'utf8');
        args.push(`--config=${customRulesPath}`);
      }

      args.push(tmpDir);

      log.info(
        {
          rulesDir: BUILTIN_RULES_DIR,
          rulesDirExists: existsSync(BUILTIN_RULES_DIR),
          fileCount: activeFiles.length,
          tmpDir,
          sampleArgs: args.slice(0, 6),
        },
        'semgrep starting'
      );
      const result = await runSubprocess('semgrep', args, {
        timeoutMs: PIPELINE_DEFAULTS.SEMGREP_TIMEOUT_MS,
        cwd: tmpDir,
      });

      if (result.timedOut) {
        log.warn('semgrep timed out — partial results may be missing');
      }

      // ALWAYS log exit code, stdout/stderr length, and a stderr sample.
      // Without this, a silent zero-finding scan looks identical to a successful
      // zero-finding scan and we cannot tell which one is happening in prod.
      log.info(
        {
          exitCode: result.exitCode,
          stdoutLen: result.stdout.length,
          stderrLen: result.stderr.length,
          stderrSample: result.stderr.slice(0, 800),
          stdoutSample: result.stdout.slice(0, 400),
        },
        'semgrep finished'
      );

      // semgrep exits 1 when findings are present, 0 when clean
      if (result.exitCode > 1) {
        log.error({ exitCode: result.exitCode, stderr: result.stderr }, 'semgrep error');
        return [];
      }

      const semgrepOutput = safeParseSemgrep(result.stdout);
      if (!semgrepOutput) {
        log.error({ stdoutSample: result.stdout.slice(0, 1000) }, 'Failed to parse semgrep JSON output');
        return [];
      }

      // If semgrep silently failed to load any rules, the JSON output has
      // results=[] and errors=[<RuleParseError>...]. Surface this loudly so
      // we never again spend hours debugging a silent rules-not-loading bug.
      if (semgrepOutput.errors && semgrepOutput.errors.length > 0) {
        log.error(
          {
            errorCount: semgrepOutput.errors.length,
            errors: semgrepOutput.errors.slice(0, 10),
          },
          'semgrep reported errors in its JSON output — rules may be failing to load'
        );
      }

      // Capture diagnostic counters from the semgrep JSON envelope so we can
      // see at a glance whether files were even scanned or rules were skipped.
      const envelope = result.stdout ? safeParseEnvelope(result.stdout) : null;
      log.info(
        {
          rawResultCount: semgrepOutput.results.length,
          semgrepErrorCount: semgrepOutput.errors?.length ?? 0,
          pathsScanned: envelope?.paths?.scanned?.length ?? null,
          skippedRulesCount: Array.isArray(envelope?.skipped_rules) ? envelope.skipped_rules.length : null,
          pathsScannedSample: envelope?.paths?.scanned?.slice?.(0, 5) ?? null,
        },
        'semgrep envelope diagnostics'
      );

      const findings = semgrepOutput.results.map((match) =>
        this.toRawFinding(match, tmpDir, activeFiles)
      ).filter((f): f is RawFinding => f !== null);

      log.info(
        { fileCount: activeFiles.length, findings: findings.length, rawSemgrepResultCount: semgrepOutput.results.length },
        'StaticAnalyzer complete'
      );
      return findings;
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') {
        log.warn(
          'semgrep not installed — skipping static analysis. Install with: brew install semgrep'
        );
        return [];
      }
      log.error({ err }, 'StaticAnalyzer unexpected error');
      return [];
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async writeFilesToTmp(tmpDir: string, files: AnalysisFile[]): Promise<void> {
    await Promise.all(
      files.map(async (file) => {
        const destPath = join(tmpDir, file.path);
        const destDir = dirname(destPath);
        await mkdir(destDir, { recursive: true });
        await writeFile(destPath, file.content, 'utf8');
      })
    );
  }

  private toRawFinding(
    match: SemgrepResult['results'][0],
    tmpDir: string,
    files: AnalysisFile[]
  ): RawFinding | null {
    // Resolve the semgrep-reported path back to the original repo-relative path.
    // Use node's path.relative so we handle every shape semgrep can produce
    // (absolute /tmp/.../server.js, ./server.js, server.js, with or without
    // trailing slashes). The previous startsWith() check silently dropped
    // every finding when the prefix didn't match exactly — which was the
    // observed prod failure mode where local returned 9 findings and the
    // worker returned 0.
    let relativePath = pathRelative(tmpDir, match.path);
    if (relativePath.startsWith('..') || relativePath === '') {
      // semgrep gave us a path that isn't under tmpDir at all — fall back
      // to whatever it reported, stripped of any leading "./".
      relativePath = match.path.replace(/^\.\//, '');
    }

    // Best-effort match against the input file set. If the lookup fails we
    // STILL surface the finding rather than dropping it on the floor — a
    // slightly-off filePath is far better than a silently-missing critical
    // vulnerability.
    const sourceFile = files.find((f) => f.path === relativePath);
    if (!sourceFile) {
      // Try a basename fallback before giving up — useful when semgrep
      // normalizes nested paths differently than we expect.
      const base = relativePath.split('/').pop();
      const byBase = base ? files.find((f) => f.path.endsWith('/' + base) || f.path === base) : undefined;
      if (byBase) relativePath = byBase.path;
    }

    const severity =
      SEVERITY_MAP[match.extra.severity.toUpperCase()] ?? Severity.MEDIUM;

    const category = inferCategory(match.check_id, match.extra.message);

    return {
      ruleId: match.check_id,
      title: match.check_id
        .replace(/^ai-/, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      description: match.extra.message,
      severity,
      category,
      filePath: relativePath,
      lineStart: match.start.line,
      lineEnd: match.end.line,
      codeSnippet: match.extra.lines.slice(0, 500),
      isAIPatternSpecific:
        (match.extra.metadata['ai-specific'] as boolean | undefined) === true ||
        match.check_id.startsWith('ai-'),
      detector: 'StaticAnalyzer',
      metadata: match.extra.metadata,
    };
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function safeParseSemgrep(output: string): SemgrepResult | null {
  try {
    const parsed: unknown = JSON.parse(output);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'results' in parsed &&
      Array.isArray((parsed as { results: unknown }).results)
    ) {
      return parsed as SemgrepResult;
    }
    return null;
  } catch {
    return null;
  }
}

// Parse the broader semgrep envelope (not just results+errors) to extract
// diagnostic counters: paths.scanned, skipped_rules. Used for the "envelope
// diagnostics" log line so we can tell at a glance whether semgrep actually
// scanned files in the deployed container.
interface SemgrepEnvelope {
  paths?: { scanned?: string[] };
  skipped_rules?: unknown[];
}
function safeParseEnvelope(output: string): SemgrepEnvelope | null {
  try {
    const parsed = JSON.parse(output) as SemgrepEnvelope;
    return parsed;
  } catch {
    return null;
  }
}

function inferCategory(ruleId: string, message: string): FindingCategory {
  const text = `${ruleId} ${message}`.toLowerCase();
  for (const [pattern, category] of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return category;
  }
  return FindingCategory.SECURITY;
}
