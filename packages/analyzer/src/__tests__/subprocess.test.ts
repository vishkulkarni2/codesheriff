/**
 * Tests for runSubprocess() — safe subprocess execution utility.
 *
 * Uses real OS commands (echo, cat, sh) available on macOS/Linux.
 * Tests validate: output capture, exit codes, timeout kill, size caps,
 * stdin piping, and spawn failure handling.
 */

import { describe, it, expect } from 'vitest';
import { runSubprocess, SubprocessError } from '../utils/subprocess.js';

// All tests use a generous timeout for CI environments
const OPTS_BASE = { timeoutMs: 5_000 };

describe('runSubprocess', () => {
  // -------------------------------------------------------------------------
  // Basic output capture
  // -------------------------------------------------------------------------

  it('captures stdout from a successful command', async () => {
    const result = await runSubprocess('echo', ['hello world'], OPTS_BASE);
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('captures stderr separately from stdout', async () => {
    // sh -c lets us write to specific file descriptors
    const result = await runSubprocess(
      'sh',
      ['-c', 'echo out && echo err >&2'],
      OPTS_BASE
    );
    expect(result.stdout.trim()).toBe('out');
    expect(result.stderr.trim()).toBe('err');
  });

  it('returns non-zero exit code for failing commands', async () => {
    const result = await runSubprocess('sh', ['-c', 'exit 42'], OPTS_BASE);
    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  it('returns empty stdout for commands that produce no output', async () => {
    const result = await runSubprocess('true', [], OPTS_BASE);
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Stdin piping
  // -------------------------------------------------------------------------

  it('pipes stdin data into the subprocess', async () => {
    const result = await runSubprocess('cat', [], {
      ...OPTS_BASE,
      stdin: 'hello from stdin',
    });
    expect(result.stdout).toBe('hello from stdin');
    expect(result.exitCode).toBe(0);
  });

  it('handles multiline stdin correctly', async () => {
    const input = 'line1\nline2\nline3';
    const result = await runSubprocess('cat', [], {
      ...OPTS_BASE,
      stdin: input,
    });
    expect(result.stdout).toBe(input);
  });

  // -------------------------------------------------------------------------
  // Timeout behavior
  // -------------------------------------------------------------------------

  it('kills the process and sets timedOut after the timeout expires', async () => {
    // sleep 60 will be killed after 150ms
    const result = await runSubprocess('sleep', ['60'], {
      timeoutMs: 150,
    });
    expect(result.timedOut).toBe(true);
    // Exit code after SIGKILL is non-zero
    expect(result.exitCode).not.toBe(0);
  });

  it('does not time out for processes that finish before the deadline', async () => {
    const result = await runSubprocess('echo', ['fast'], { timeoutMs: 5_000 });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Output size capping
  // -------------------------------------------------------------------------

  it('captures output up to maxOutputBytes and then truncates', async () => {
    // Generate 100 bytes of output; cap at 50 bytes
    const result = await runSubprocess(
      'sh',
      ['-c', 'printf "%0.s0" {1..100}'],
      { ...OPTS_BASE, maxOutputBytes: 50 }
    );
    // Captured portion should be ≤ 50 bytes
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(50);
  });

  it('captures full output when it is below the size cap', async () => {
    const result = await runSubprocess('echo', ['short'], {
      ...OPTS_BASE,
      maxOutputBytes: 1_000,
    });
    expect(result.stdout.trim()).toBe('short');
  });

  // -------------------------------------------------------------------------
  // Spawn failure
  // -------------------------------------------------------------------------

  it('throws SubprocessError when the command does not exist', async () => {
    await expect(
      runSubprocess('__does_not_exist_xyz__', [], OPTS_BASE)
    ).rejects.toThrow(SubprocessError);
  });

  it('SubprocessError has the correct name', async () => {
    try {
      await runSubprocess('__does_not_exist_xyz__', [], OPTS_BASE);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SubprocessError);
      expect((err as SubprocessError).name).toBe('SubprocessError');
    }
  });

  // -------------------------------------------------------------------------
  // Environment isolation
  // -------------------------------------------------------------------------

  it('does not pass arbitrary parent env vars into the subprocess', async () => {
    // Set a sentinel var in the test process; subprocess should not see it
    process.env['CODESHERIFF_TEST_SECRET'] = 'DO_NOT_LEAK';
    const result = await runSubprocess(
      'sh',
      ['-c', 'echo "${CODESHERIFF_TEST_SECRET:-EMPTY}"'],
      OPTS_BASE
    );
    // The subprocess environment is minimal; the sentinel should not be present
    expect(result.stdout.trim()).toBe('EMPTY');
    delete process.env['CODESHERIFF_TEST_SECRET'];
  });

  it('merges custom env vars into the safe minimal environment', async () => {
    const result = await runSubprocess(
      'sh',
      ['-c', 'echo "$MY_CUSTOM_VAR"'],
      { ...OPTS_BASE, env: { MY_CUSTOM_VAR: 'expected_value' } }
    );
    expect(result.stdout.trim()).toBe('expected_value');
  });

  // -------------------------------------------------------------------------
  // cwd option
  // -------------------------------------------------------------------------

  it('runs the command in the specified working directory', async () => {
    const result = await runSubprocess('pwd', [], {
      ...OPTS_BASE,
      cwd: '/tmp',
    });
    // /tmp may resolve to /private/tmp on macOS — check suffix
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
  });
});
