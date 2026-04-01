/**
 * Main evolution loop.
 *
 * For each category:
 *   1. Load corpus entries for that category.
 *   2. Evolve the semgrep rule — write winner to outputDir/rules/ if improved.
 *   3. Evolve the Claude system prompt — write winner to outputDir/prompts/ if improved.
 *   4. Log every result to evolution-log.tsv.
 * Repeat until interrupted.
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { loadCorpus, filterByCategory } from "./corpus/index.js";
import { RuleEvolver } from "./evolvers/rule-evolver.js";
import { PromptEvolver } from "./evolvers/prompt-evolver.js";
import { appendLog, initLog, makeRunId, type EvolveStatus } from "./logger.js";
import type { DetectionResult } from "./metrics/index.js";

export interface LoopOptions {
  anthropicApiKey: string;
  corpusDir: string;
  outputDir: string;
  logPath: string;
  rulesPerCycle?: number;
  promptsPerCycle?: number;
  dryRun?: boolean;
}

const CATEGORIES = ["auth", "hallucination", "logic"] as const;

// Minimal seed rules used when no evolved rule exists yet
const SEED_RULES: Record<string, string> = {
  auth: `rules:
  - id: autotune-auth-seed
    patterns:
      - pattern: jwt.decode(...)
    message: JWT decoded without server-side verification
    languages: [typescript, javascript]
    severity: WARNING
    metadata:
      category: security
`,
  hallucination: `rules:
  - id: autotune-hallucination-seed
    patterns:
      - pattern: crypto.encryptAES(...)
    message: Possible AI-hallucinated crypto method
    languages: [typescript, javascript]
    severity: WARNING
    metadata:
      category: security
`,
  logic: `rules:
  - id: autotune-logic-seed
    patterns:
      - pattern: if (!$USER.verified) { ... }
    message: Inverted auth guard may allow unverified users
    languages: [typescript, javascript]
    severity: WARNING
    metadata:
      category: security
`,
};

// Seed prompts used when no evolved prompt exists yet
const SEED_PROMPTS: Record<string, string> = {
  auth: `You are a security expert reviewing TypeScript code for authentication vulnerabilities.
Focus on: JWT misuse, missing server-side verification, client-side trust of tokens,
hardcoded credentials, and missing authorization checks.
Be precise — flag real issues, not style problems.`,

  hallucination: `You are reviewing AI-generated TypeScript code for hallucinated API calls.
Look for: calls to methods that don't exist in standard libraries, invented npm packages,
incorrect method signatures, and impossible API combinations.
Flag only clear hallucinations, not deprecated but real APIs.`,

  logic: `You are reviewing TypeScript code for logic bugs in authentication and access control.
Focus on: inverted conditions, off-by-one errors in permission checks, race conditions,
missing null checks on auth values, and bypasses due to type coercion.`,
};

async function readOrDefault(filePath: string, fallback: string): Promise<string> {
  try {
    await access(filePath);
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function runEvolutionLoop(options: LoopOptions): Promise<void> {
  const {
    anthropicApiKey,
    corpusDir,
    outputDir,
    logPath,
    rulesPerCycle = 3,
    promptsPerCycle = 3,
    dryRun = false,
  } = options;

  await initLog(logPath);
  await ensureDir(join(outputDir, "rules"));
  await ensureDir(join(outputDir, "prompts"));

  const ruleEvolver = new RuleEvolver(anthropicApiKey);
  const promptEvolver = new PromptEvolver(anthropicApiKey);

  const corpus = await loadCorpus(corpusDir);
  console.log(`[autotune] Loaded ${corpus.length} corpus entries from ${corpusDir}`);

  let cycle = 0;

  // Loop forever — stopped by SIGINT or process management
  // eslint-disable-next-line no-constant-condition
  while (true) {
    cycle++;
    const runId = makeRunId();
    console.log(`\n[autotune] === Cycle ${cycle} (run ${runId}) ===`);

    const summary: Array<{
      type: "rule" | "prompt";
      category: string;
      result: DetectionResult;
      status: EvolveStatus;
    }> = [];

    for (const category of CATEGORIES) {
      const entries = filterByCategory(corpus, category);
      if (entries.length === 0) {
        console.log(`[autotune] No corpus entries for category: ${category}, skipping`);
        continue;
      }

      // --- Rule evolution ---
      const ruleOutPath = join(outputDir, "rules", `${category}.yaml`);
      const baseRule = await readOrDefault(ruleOutPath, SEED_RULES[category] ?? "");

      let ruleStatus: EvolveStatus = "discard";
      let ruleResult: DetectionResult | undefined;

      try {
        console.log(`[autotune] Evolving rule for ${category} (${entries.length} corpus entries)...`);
        const { rule, result, improved } = await ruleEvolver.evolve(
          baseRule,
          category,
          entries,
          rulesPerCycle
        );
        ruleResult = result;

        if (improved) {
          ruleStatus = "keep";
          if (!dryRun) {
            await writeFile(ruleOutPath, rule, "utf8");
          }
          console.log(
            `[autotune] Rule improved for ${category}: F1=${result.f1.toFixed(3)} ` +
            `(P=${result.precision.toFixed(3)}, R=${result.recall.toFixed(3)})`
          );
        } else {
          console.log(
            `[autotune] Rule not improved for ${category}: F1=${result.f1.toFixed(3)}`
          );
        }
      } catch (err) {
        ruleStatus = "crash";
        console.error(`[autotune] Rule evolver crashed for ${category}:`, err);
      }

      summary.push({
        type: "rule",
        category,
        result: ruleResult ?? { tp: 0, fp: 0, fn: 0, tn: 0, precision: 0, recall: 0, f1: 0 },
        status: ruleStatus,
      });

      // --- Prompt evolution ---
      const promptOutPath = join(outputDir, "prompts", `${category}.txt`);
      const basePrompt = await readOrDefault(promptOutPath, SEED_PROMPTS[category] ?? "");

      let promptStatus: EvolveStatus = "discard";
      let promptResult: DetectionResult | undefined;

      try {
        console.log(`[autotune] Evolving prompt for ${category}...`);
        const { prompt, result, improved } = await promptEvolver.evolve(
          basePrompt,
          category,
          entries,
          promptsPerCycle
        );
        promptResult = result;

        if (improved) {
          promptStatus = "keep";
          if (!dryRun) {
            await writeFile(promptOutPath, prompt, "utf8");
          }
          console.log(
            `[autotune] Prompt improved for ${category}: F1=${result.f1.toFixed(3)} ` +
            `(P=${result.precision.toFixed(3)}, R=${result.recall.toFixed(3)})`
          );
        } else {
          console.log(
            `[autotune] Prompt not improved for ${category}: F1=${result.f1.toFixed(3)}`
          );
        }
      } catch (err) {
        promptStatus = "crash";
        console.error(`[autotune] Prompt evolver crashed for ${category}:`, err);
      }

      summary.push({
        type: "prompt",
        category,
        result: promptResult ?? { tp: 0, fp: 0, fn: 0, tn: 0, precision: 0, recall: 0, f1: 0 },
        status: promptStatus,
      });
    }

    // Log all results
    for (const entry of summary) {
      await appendLog(logPath, {
        commit: runId,
        type: entry.type,
        category: entry.category,
        f1: entry.result.f1,
        precision: entry.result.precision,
        recall: entry.result.recall,
        status: entry.status,
        description: `cycle=${cycle} tp=${entry.result.tp} fp=${entry.result.fp} fn=${entry.result.fn} tn=${entry.result.tn}`,
      });
    }

    // Summary table
    const kept = summary.filter((e) => e.status === "keep").length;
    const crashed = summary.filter((e) => e.status === "crash").length;
    console.log(
      `\n[autotune] Cycle ${cycle} done — ${kept} improved, ${crashed} crashed, ` +
      `${summary.length - kept - crashed} unchanged`
    );

    if (dryRun) {
      console.log("[autotune] dry-run mode: exiting after one cycle");
      break;
    }
  }
}
