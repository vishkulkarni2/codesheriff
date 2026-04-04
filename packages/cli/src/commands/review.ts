/**
 * `codesheriff review`
 *
 * Reviews staged git changes in the current directory, or the entire
 * current directory if nothing is staged.
 *
 * Usage:
 *   codesheriff review
 *   codesheriff review --json
 *   codesheriff review --fix
 *   codesheriff review --static-only
 */

import { Command } from 'commander';
import ora from 'ora';
import { collectFiles } from '../lib/file-collector.js';
import { runPipeline } from '../lib/runner.js';
import { renderResults, renderError } from '../lib/renderer.js';

export function reviewCommand(): Command {
  const cmd = new Command('review');

  cmd
    .description('Review staged git changes (or current directory if nothing is staged)')
    .option('--json', 'Output results as JSON (for CI/CD integration)')
    .option('--fix', 'Show suggested fixes for each finding')
    .option('--static-only', 'Skip LLM-based detectors (faster, no API key required)')
    .action(async (options: { json?: boolean; fix?: boolean; staticOnly?: boolean }) => {
      const cwd = process.cwd();
      const spinner = options.json ? null : ora('Collecting files…').start();

      try {
        // Collect staged files first; fall back to full dir
        const files = await collectFiles(cwd, { stagedOnly: true });

        if (files.length === 0) {
          spinner?.stop();
          const msg = 'No supported files found to scan.';
          if (options.json) {
            process.stdout.write(JSON.stringify({ error: msg }) + '\n');
          } else {
            console.log(`\n⚠  ${msg}\n`);
          }
          return;
        }

        if (spinner) spinner.text = `Running analysis on ${files.length} file${files.length === 1 ? '' : 's'}…`;

        const result = await runPipeline(files, { staticOnly: options.staticOnly });

        spinner?.stop();

        renderResults(result, {
          json: options.json,
          fix: options.fix,
          target: cwd,
        });

        // Exit with non-zero if critical findings or risk > 70 (useful for CI pre-commit hooks)
        const hasCritical = result.findings.some((f) => f.severity === 'CRITICAL');
        if (hasCritical || result.riskScore >= 70) {
          process.exit(1);
        }
      } catch (err) {
        spinner?.stop();
        const message = err instanceof Error ? err.message : String(err);
        renderError(message, options.json ?? false);
        process.exit(1);
      }
    });

  return cmd;
}
