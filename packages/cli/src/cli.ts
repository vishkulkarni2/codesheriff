#!/usr/bin/env node
/**
 * CodeSheriff CLI
 *
 * Entry point. Sets up Commander with two subcommands:
 *   codesheriff review   — scans current directory or staged git changes
 *   codesheriff scan     — scans a specific file or directory
 *
 * TODO: Gate CLI access behind a CodeSheriff API key (TEAM+ only).
 * The CLI currently runs locally with just an Anthropic API key and has no
 * authentication to the CodeSheriff backend. Add a --api-key flag (or
 * CODESHERIFF_API_KEY env var) that validates against the backend before
 * allowing scans. Free-tier users should get a clear upgrade prompt.
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { reviewCommand } from './commands/review.js';
import { scanCommand } from './commands/scan.js';

function checkExternalTools(): void {
  const missing: string[] = [];
  for (const tool of ['semgrep', 'trufflehog']) {
    try {
      execSync(`which ${tool}`, { stdio: 'pipe' });
    } catch {
      missing.push(tool);
    }
  }
  if (missing.length > 0) {
    process.stderr.write(
      `\x1b[33mNote: ${missing.join(', ')} not found. Install ${missing.length === 1 ? 'it' : 'them'} for full analysis.\x1b[0m\n`
    );
  }
}

checkExternalTools();

const program = new Command();

program
  .name('codesheriff')
  .description('AI code safety scanner — hallucination detection, secrets, auth flaws, logic bugs')
  .version('0.1.0');

program.addCommand(reviewCommand());
program.addCommand(scanCommand());

program.parse(process.argv);
