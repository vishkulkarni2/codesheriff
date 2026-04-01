/**
 * RuleEvolver — generates and tests semgrep rule variants using Claude.
 *
 * For each evolution cycle:
 *   1. Ask Claude to produce N variations of a base semgrep YAML rule.
 *   2. Test each variant against the labeled corpus via `semgrep --json`.
 *   3. Keep the variant with the highest F1; return it if it beats the baseline.
 */

import { spawn } from "node:child_process";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { CorpusEntry } from "../corpus/types.js";
import { buildResult, type DetectionResult } from "../metrics/index.js";

export class RuleEvolver {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /** Ask Claude to generate N semgrep YAML rule variants from a base rule. */
  async generateVariants(
    baseRule: string,
    category: string,
    n: number
  ): Promise<string[]> {
    const message = await this.client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are a semgrep rule expert specializing in detecting ${category} vulnerabilities in AI-generated TypeScript code.

Given this base semgrep YAML rule:
\`\`\`yaml
${baseRule}
\`\`\`

Generate ${n} distinct variants that might improve detection coverage.
Each variant should:
- Be valid semgrep YAML with a unique rule id
- Try a different pattern, metavariable, or structural approach
- Stay focused on the same ${category} vulnerability class

Return ONLY a JSON array of ${n} YAML strings, no other text.
Example format: ["rules:\\n  - id: ...", "rules:\\n  - id: ..."]`,
        },
      ],
    });

    const text =
      message.content[0]?.type === "text" ? message.content[0].text : "";

    try {
      // Extract JSON array from the response
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("No JSON array found in response");
      const variants = JSON.parse(match[0]) as unknown[];
      return variants
        .filter((v): v is string => typeof v === "string")
        .slice(0, n);
    } catch {
      return [];
    }
  }

  /** Run a semgrep YAML rule against all corpus entries and return detection metrics. */
  async testRule(
    ruleYaml: string,
    corpus: CorpusEntry[]
  ): Promise<DetectionResult> {
    const workDir = join(tmpdir(), `autotune-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });

    const ruleFile = join(workDir, "rule.yaml");
    await writeFile(ruleFile, ruleYaml, "utf8");

    let tp = 0, fp = 0, fn = 0, tn = 0;

    try {
      for (const entry of corpus) {
        const ext = entry.language === "python" ? ".py" : ".ts";
        const codeFile = join(workDir, `snippet-${randomUUID()}${ext}`);
        await writeFile(codeFile, entry.code, "utf8");

        const fired = await runSemgrep(ruleFile, codeFile);

        if (entry.label === "vulnerable") {
          if (fired) tp++; else fn++;
        } else {
          if (fired) fp++; else tn++;
        }
      }
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }

    return buildResult(tp, fp, fn, tn);
  }

  /**
   * Run one evolution cycle.
   * Returns the best variant found (or the base rule if nothing improved).
   */
  async evolve(
    baseRule: string,
    category: string,
    corpus: CorpusEntry[],
    variantsPerCycle = 3
  ): Promise<{ rule: string; result: DetectionResult; improved: boolean }> {
    const baseline = await this.testRule(baseRule, corpus);

    const variants = await this.generateVariants(baseRule, category, variantsPerCycle);
    if (variants.length === 0) {
      return { rule: baseRule, result: baseline, improved: false };
    }

    let bestRule = baseRule;
    let bestResult = baseline;

    for (const variant of variants) {
      try {
        const result = await this.testRule(variant, corpus);
        if (result.f1 > bestResult.f1) {
          bestResult = result;
          bestRule = variant;
        }
      } catch {
        // Invalid rule YAML or semgrep crash — skip
      }
    }

    return {
      rule: bestRule,
      result: bestResult,
      improved: bestRule !== baseRule,
    };
  }
}

/** Spawn semgrep and return true if it produced any matches. */
async function runSemgrep(
  ruleFile: string,
  codeFile: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "semgrep",
      ["--config", ruleFile, "--json", "--quiet", codeFile],
      {
        shell: false,
        env: {
          PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: process.env["HOME"] ?? "/tmp",
          TMPDIR: process.env["TMPDIR"] ?? "/tmp",
        },
      }
    );

    const chunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    child.on("error", () => resolve(false));
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        // semgrep exits 1 when matches found, 0 when not
        resolve(false);
        return;
      }
      try {
        const output = Buffer.concat(chunks).toString("utf8");
        const json = JSON.parse(output) as { results?: unknown[] };
        resolve(Array.isArray(json.results) && json.results.length > 0);
      } catch {
        resolve(false);
      }
    });
  });
}
