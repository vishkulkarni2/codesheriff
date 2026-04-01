/**
 * Corpus loader — reads labeled code snippets from the corpus/ directory.
 *
 * File naming convention: {category}/{label}-{NNN}.ts
 *   category: auth | hallucination | logic | secret
 *   label:    vulnerable | safe
 *
 * Each file may start with metadata comment lines:
 *   // @description <text>
 *   // @expectedRuleIds <comma-separated rule IDs>
 */

import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { glob } from "glob";
import type { CorpusEntry } from "./types.js";

const CATEGORY_VALUES = ["auth", "hallucination", "logic", "secret"] as const;
const LABEL_VALUES = ["vulnerable", "safe"] as const;

type Category = (typeof CATEGORY_VALUES)[number];
type Label = (typeof LABEL_VALUES)[number];

function isCategory(s: string): s is Category {
  return (CATEGORY_VALUES as readonly string[]).includes(s);
}

function isLabel(s: string): s is Label {
  return (LABEL_VALUES as readonly string[]).includes(s);
}

function parseMetaComment(
  line: string,
  key: string
): string | undefined {
  const prefix = `// @${key} `;
  return line.startsWith(prefix) ? line.slice(prefix.length).trim() : undefined;
}

export async function loadCorpus(corpusDir: string): Promise<CorpusEntry[]> {
  const files = await glob("**/*.ts", { cwd: corpusDir, absolute: true });
  const entries: CorpusEntry[] = [];

  for (const filePath of files.sort()) {
    const category = basename(dirname(filePath));
    const fileName = basename(filePath, ".ts"); // e.g. vulnerable-001

    const dashIdx = fileName.indexOf("-");
    if (dashIdx === -1) continue;

    const labelPart = fileName.slice(0, dashIdx);
    const numberPart = fileName.slice(dashIdx + 1);

    if (!isCategory(category) || !isLabel(labelPart)) continue;

    const raw = await readFile(filePath, "utf8");
    const lines = raw.split("\n");

    let description = `${category}/${fileName}`;
    let expectedRuleIds: string[] | undefined;
    let codeStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const desc = parseMetaComment(line, "description");
      const ruleIds = parseMetaComment(line, "expectedRuleIds");

      if (desc !== undefined) {
        description = desc;
        codeStartLine = i + 1;
      } else if (ruleIds !== undefined) {
        expectedRuleIds = ruleIds.split(",").map((r) => r.trim()).filter(Boolean);
        codeStartLine = i + 1;
      } else if (!line.startsWith("//")) {
        break;
      } else {
        codeStartLine = i + 1;
      }
    }

    const code = lines.slice(codeStartLine).join("\n").trim();

    entries.push({
      id: `${category}-${labelPart}-${numberPart}`,
      category,
      label: labelPart,
      language: "typescript",
      code,
      description,
      expectedRuleIds,
    });
  }

  return entries;
}

export function filterByCategory(
  corpus: CorpusEntry[],
  category: string
): CorpusEntry[] {
  return corpus.filter((e) => e.category === category);
}
