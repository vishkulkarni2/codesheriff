/**
 * Safe subprocess execution utility.
 * Wraps child_process.spawn with timeout support, output size limits,
 * and structured error handling. Used by SecretsScanner and StaticAnalyzer.
 *
 * Security note: callers MUST pass command arguments as an array (never
 * as a shell-interpolated string) to prevent command injection. This
 * module never invokes a shell — shell: false is enforced.
 */

import { spawn } from 'node:child_process';
import { logger } from './logger.js';

export interface SubprocessOptions {
  /** Timeout in milliseconds. Process is killed after this. */
  timeoutMs: number;
  /** Maximum stdout bytes to capture. Excess is truncated. */
  maxOutputBytes?: number;
  /** Working directory for the subprocess */
  cwd?: string;
  /** Environment variables (merged with a minimal safe env, not full process.env) */
  env?: Record<string, string>;
  /** Stdin data to pipe into the process */
  stdin?: string;
}

export interface SubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const DEFAULT_MAX_OUTPUT = 10 * 1024 * 1024; // 10 MB

/**
 * Execute a subprocess safely with strict controls.
 *
 * @param command - Executable path (no shell expansion)
 * @param args - Arguments array (never pass user input through shell interpolation)
 * @param opts - Execution options
 * @throws {SubprocessError} on timeout or unrecoverable failure
 */
export async function runSubprocess(
  command: string,
  args: string[],
  opts: SubprocessOptions
): Promise<SubprocessResult> {
  const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  // Provide a minimal environment — do NOT inherit the full process.env
  // to avoid leaking API keys or other secrets into subprocess environment.
  const safeEnv: Record<string, string> = {
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env['HOME'] ?? '/tmp',
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
    ...opts.env,
  };

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false, // NEVER use shell: true — prevents command injection
      cwd: opts.cwd,
      env: safeEnv,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutTruncated = false;
    let timedOut = false;

    // Hard timeout — kill the process if it runs too long
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      logger.warn({ command, args, timeoutMs: opts.timeoutMs }, 'subprocess timed out');
    }, opts.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes < maxBytes) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      } else if (!stdoutTruncated) {
        stdoutTruncated = true;
        logger.warn({ command, maxBytes }, 'subprocess stdout truncated at limit');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    // Guard against child.stdin being null — Node types it as Writable | null
    // even with default pipe stdio, since the process may fail to open stdin.
    if (opts.stdin !== undefined && child.stdin !== null) {
      child.stdin.end(opts.stdin, 'utf8');
    }

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new SubprocessError(`Failed to spawn ${command}: ${err.message}`, -1));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code ?? -1,
        timedOut,
      });
    });
  });
}

export class SubprocessError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number
  ) {
    super(message);
    this.name = 'SubprocessError';
  }
}
