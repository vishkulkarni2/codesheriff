/**
 * Evolution logger — appends TSV rows to evolution-log.tsv.
 * Format mirrors autoresearch results.tsv:
 *   commit\ttype\tcategory\tf1\tprecision\trecall\tstatus\tdescription
 */

import { appendFile, access, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type EvolverType = "rule" | "prompt";
export type EvolveStatus = "keep" | "discard" | "crash";

export interface LogEntry {
  commit: string;
  type: EvolverType;
  category: string;
  f1: number;
  precision: number;
  recall: number;
  status: EvolveStatus;
  description: string;
}

const HEADER = "commit\ttype\tcategory\tf1\tprecision\trecall\tstatus\tdescription\n";

export async function initLog(logPath: string): Promise<void> {
  try {
    await access(logPath);
  } catch {
    await writeFile(logPath, HEADER, "utf8");
  }
}

export async function appendLog(logPath: string, entry: LogEntry): Promise<void> {
  const row = [
    entry.commit,
    entry.type,
    entry.category,
    entry.f1.toFixed(4),
    entry.precision.toFixed(4),
    entry.recall.toFixed(4),
    entry.status,
    entry.description.replace(/\t/g, " "),
  ].join("\t") + "\n";

  await appendFile(logPath, row, "utf8");
}

/** Generate a short commit-style ID for this evolution run. */
export function makeRunId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
