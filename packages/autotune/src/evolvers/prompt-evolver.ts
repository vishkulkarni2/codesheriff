/**
 * PromptEvolver — generates and tests Claude system prompt variants.
 *
 * For each evolution cycle:
 *   1. Ask Claude (as meta-prompt author) to produce N system prompt variants.
 *   2. Test each variant by calling Claude with the prompt + each corpus snippet.
 *   3. Parse VULNERABLE / SAFE answer and compare with corpus label.
 *   4. Keep the variant with the highest F1; return it if it beats the baseline.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { CorpusEntry } from "../corpus/types.js";
import { buildResult, type DetectionResult } from "../metrics/index.js";

export class PromptEvolver {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /** Ask Claude to generate N system prompt variants for detecting a category. */
  async generateVariants(
    basePrompt: string,
    category: string,
    n: number
  ): Promise<string[]> {
    const message = await this.client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are an AI security researcher optimizing prompts that detect ${category} vulnerabilities in AI-generated code.

Base system prompt:
---
${basePrompt}
---

Generate ${n} distinct variants of this system prompt that might improve detection accuracy.
Each variant should:
- Change the framing, emphasis, or instructions
- Stay focused on detecting ${category} vulnerabilities
- Be concise (under 300 words)

Return ONLY a JSON array of ${n} system prompt strings, no other text.`,
        },
      ],
    });

    const text =
      message.content[0]?.type === "text" ? message.content[0].text : "";

    try {
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

  /**
   * Test a system prompt against the corpus.
   * Calls Claude with each snippet and parses the VULNERABLE/SAFE verdict.
   */
  async testPrompt(
    systemPrompt: string,
    corpus: CorpusEntry[],
    _category: string
  ): Promise<DetectionResult> {
    let tp = 0, fp = 0, fn = 0, tn = 0;

    for (const entry of corpus) {
      const verdict = await this.callForVerdict(systemPrompt, entry.code);

      if (entry.label === "vulnerable") {
        if (verdict === "vulnerable") tp++; else fn++;
      } else {
        if (verdict === "vulnerable") fp++; else tn++;
      }
    }

    return buildResult(tp, fp, fn, tn);
  }

  /** Run one evolution cycle for a given system prompt and category. */
  async evolve(
    basePrompt: string,
    category: string,
    corpus: CorpusEntry[],
    variantsPerCycle = 3
  ): Promise<{ prompt: string; result: DetectionResult; improved: boolean }> {
    const baseline = await this.testPrompt(basePrompt, corpus, category);

    const variants = await this.generateVariants(basePrompt, category, variantsPerCycle);
    if (variants.length === 0) {
      return { prompt: basePrompt, result: baseline, improved: false };
    }

    let bestPrompt = basePrompt;
    let bestResult = baseline;

    for (const variant of variants) {
      try {
        const result = await this.testPrompt(variant, corpus, category);
        if (result.f1 > bestResult.f1) {
          bestResult = result;
          bestPrompt = variant;
        }
      } catch {
        // API error or parse failure — skip
      }
    }

    return {
      prompt: bestPrompt,
      result: bestResult,
      improved: bestPrompt !== basePrompt,
    };
  }

  /** Ask Claude to analyze a snippet; return 'vulnerable' or 'safe'. */
  private async callForVerdict(
    systemPrompt: string,
    code: string
  ): Promise<"vulnerable" | "safe"> {
    try {
      const message = await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Analyze this code snippet:\n\n\`\`\`\n${code}\n\`\`\`\n\nRespond with exactly VULNERABLE or SAFE on the first line, then a brief explanation.`,
          },
        ],
      });

      const text =
        message.content[0]?.type === "text"
          ? message.content[0].text.toUpperCase()
          : "";
      return text.startsWith("VULNERABLE") ? "vulnerable" : "safe";
    } catch {
      return "safe"; // fail open — don't inflate FP counts on API errors
    }
  }
}
