/**
 * @codesheriff/autotune — entry point.
 *
 * When run directly:
 *   ANTHROPIC_API_KEY=sk-... node packages/autotune/src/index.ts [--dry-run]
 *
 * Reads corpus from packages/autotune/corpus/
 * Writes evolved rules/prompts to packages/analyzer/rules/auto-generated/
 * Logs every experiment to packages/autotune/evolution-log.tsv
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runEvolutionLoop } from "./loop.js";

export { runEvolutionLoop } from "./loop.js";
export type { LoopOptions } from "./loop.js";
export { loadCorpus, filterByCategory } from "./corpus/index.js";
export type { CorpusEntry } from "./corpus/types.js";
export { calcF1, calcPrecision, calcRecall, buildResult } from "./metrics/index.js";
export type { DetectionResult } from "./metrics/index.js";
export { appendLog, initLog, makeRunId } from "./logger.js";
export type { LogEntry, EvolverType, EvolveStatus } from "./logger.js";
export { RuleEvolver } from "./evolvers/rule-evolver.js";
export { PromptEvolver } from "./evolvers/prompt-evolver.js";

// CLI entry point — works with tsx (process.argv[1] === absolute .ts path)
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const __dirname = dirname(__filename);
  const packageRoot = join(__dirname, "..");

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.error("[autotune] ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");

  await runEvolutionLoop({
    anthropicApiKey: apiKey,
    corpusDir: join(packageRoot, "corpus"),
    outputDir: join(packageRoot, "..", "analyzer", "rules", "auto-generated"),
    logPath: join(packageRoot, "evolution-log.tsv"),
    rulesPerCycle: 3,
    promptsPerCycle: 3,
    dryRun,
  });
}
