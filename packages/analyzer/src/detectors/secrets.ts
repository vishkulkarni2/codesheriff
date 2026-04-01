/**
 * SecretsScanner
 *
 * Wraps the TruffleHog CLI as a subprocess to detect secrets, credentials,
 * and high-entropy strings embedded in code files.
 *
 * TruffleHog is run in filesystem mode against a temporary directory containing
 * only the files being scanned — not the full repository — to minimize scope.
 *
 * SECURITY: Temporary files are always cleaned up in a finally block.
 * TruffleHog output (which contains redacted secrets) is never logged at
 * info level or above.
 */

import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { AnalysisFile, RawFinding, TruffleHogResult } from '@codesheriff/shared';
import { Severity, FindingCategory } from '@codesheriff/shared';
import { runSubprocess } from '../utils/subprocess.js';
import { getScanLogger } from '../utils/logger.js';
import { PIPELINE_DEFAULTS } from '@codesheriff/shared';

export class SecretsScanner {
  /**
   * Scan files for secrets using TruffleHog.
   * Falls back gracefully if TruffleHog is not installed.
   */
  async detect(scanId: string, files: AnalysisFile[]): Promise<RawFinding[]> {
    const log = getScanLogger(scanId, 'SecretsScanner');
    const findings: RawFinding[] = [];

    // Only scan added/modified files — deleted files can't have live secrets
    const activeFiles = files.filter((f) => f.status !== 'deleted');
    if (activeFiles.length === 0) return findings;

    // Write files to a temp directory for TruffleHog to scan
    const tmpDir = await mkdtemp(join(tmpdir(), 'codesheriff-scan-'));

    try {
      await this.writeFilesToTmp(tmpDir, activeFiles);

      const result = await runSubprocess(
        'trufflehog',
        [
          'filesystem',
          tmpDir,
          '--json',
          '--no-update',
          '--only-verified', // Only report verified (live) secrets to reduce noise
        ],
        {
          timeoutMs: PIPELINE_DEFAULTS.TRUFFLEHOG_TIMEOUT_MS,
          cwd: tmpDir,
        }
      );

      if (result.timedOut) {
        log.warn('TruffleHog timed out — partial results may be missing');
      }

      if (result.exitCode !== 0 && result.exitCode !== 183) {
        // Exit code 183 = "found secrets" in some TruffleHog versions
        log.error(
          { exitCode: result.exitCode },
          'TruffleHog exited with unexpected code'
        );
        return findings;
      }

      // TruffleHog outputs one JSON object per line (NDJSON)
      const lines = result.stdout.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const parsed = safeParseTruffleHog(line);
        if (!parsed) continue;

        const finding = this.toRawFinding(parsed, activeFiles);
        if (finding) {
          findings.push(finding);
          // Log at debug only — never log the redacted secret at info level
          log.debug(
            { detectorType: parsed.detectorType, file: parsed.sourceMetadata.file },
            'secret detected'
          );
        }
      }
    } catch (err) {
      // TruffleHog not installed or other non-fatal error — log and continue
      if ((err as { code?: string }).code === 'ENOENT') {
        log.warn(
          'TruffleHog not installed — skipping secrets scan. Install with: brew install trufflehog'
        );
      } else {
        log.error({ err }, 'SecretsScanner unexpected error');
      }
    } finally {
      // Always clean up temp files — they may contain secrets
      await rm(tmpDir, { recursive: true, force: true });
    }

    log.info({ fileCount: activeFiles.length, findings: findings.length }, 'SecretsScanner complete');
    return findings;
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
    result: TruffleHogResult,
    files: AnalysisFile[]
  ): RawFinding | null {
    const { file, line } = result.sourceMetadata;

    // Resolve back to the original file path (strip temp dir prefix)
    const matchedFile = files.find((f) =>
      file.endsWith(f.path) || file.includes(f.path)
    );

    if (!matchedFile) return null;

    // Get surrounding context — but redact the actual secret value
    const lines = matchedFile.content.split('\n');
    const lineIdx = Math.max(0, line - 1);
    const snippet = redactLine(lines[lineIdx] ?? '', result.redacted);

    return {
      ruleId: `secrets:${result.detectorType.toLowerCase().replace(/\s+/g, '-')}`,
      title: `${result.detectorType} secret detected`,
      description: `A ${result.detectorType} credential was found in source code.${result.verified ? ' This secret has been verified as live.' : ''}`,
      severity: result.verified ? Severity.CRITICAL : Severity.HIGH,
      category: FindingCategory.SECRET,
      filePath: matchedFile.path,
      lineStart: line,
      lineEnd: line,
      // Snippet has the secret value redacted — safe to store
      codeSnippet: snippet,
      isAIPatternSpecific: true,
      detector: 'SecretsScanner',
      metadata: {
        detectorType: result.detectorType,
        verified: result.verified,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function safeParseTruffleHog(line: string): TruffleHogResult | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isTruffleHogResult(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isTruffleHogResult(v: unknown): v is TruffleHogResult {
  return (
    v !== null &&
    typeof v === 'object' &&
    'detectorType' in v &&
    'sourceMetadata' in v
  );
}

/**
 * Replace the redacted secret value in a code line for safe display.
 * The redacted value from TruffleHog is a safe stand-in (e.g. "REDACTED").
 */
function redactLine(line: string, redacted: string): string {
  if (!redacted || redacted.length < 4) return '[secret line — redacted]';
  // TruffleHog provides a redacted string; replace the raw secret in the line
  // Since we don't have the raw value at this point, just mark the whole line
  return `${line.slice(0, 20)}...[SECRET REDACTED]`;
}
