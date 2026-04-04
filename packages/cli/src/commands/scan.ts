/**
 * `codesheriff scan <path>`
 *
 * Scans a specific file or directory.
 *
 * Usage:
 *   codesheriff scan ./src
 *   codesheriff scan ./src/auth/login.ts
 *   codesheriff scan . --json
 *   codesheriff scan ./api --fix
 *   codesheriff scan ./src --static-only
 */

import { Command } from 'commander';
import ora from 'ora';
import { collectFiles } from '../lib/file-collector.js';
import { runPipeline } from '../lib/runner.js';
import { renderResults, renderError } from '../lib/renderer.js';

export function scanCommand(): Command {
  const cmd = new Command('scan');

  cmd
    .description('Scan a specific file or directory')
    .argument('<path>', 'File or directory to scan')
    .option('--json', 'Output results as JSON (for CI/CD integration)')
    .option('--fix', 'Show suggested fixes for each finding')
    .option('--static-only', 'Skip LLM-based detectors (faster, no API key required)')
    .action(
      async (
        targetPath: string,
        options: { json?: boolean; fix?: boolean; staticOnly?: boolean }
      ) => {
        const spinner = options.json ? null : ora('Collecting files…').start();

        try {
          const files = await collectFiles(targetPath, { stagedOnly: false });

          if (files.length === 0) {
            spinner?.stop();
            const msg = `No supported files found at: ${targetPath}`;
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
            target: targetPath,
          });

          // Exit code 1 for critical findings or high risk score (CI-friendly)
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
      }
    );

  return cmd;
}
