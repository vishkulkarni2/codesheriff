/**
 * Deterministic SHA-256 hashing utilities for cache key generation.
 * Uses Node's built-in crypto — no external deps needed.
 */

import { createHash } from 'node:crypto';

/**
 * Compute a stable SHA-256 hex digest of an arbitrary input object.
 * Used to generate cache keys for LLM responses so identical code
 * snippets always hit the cache regardless of call site.
 *
 * @param input - Any JSON-serializable value
 * @returns 64-character lowercase hex string
 */
export function sha256(input: unknown): string {
  const content =
    typeof input === 'string' ? input : JSON.stringify(input, sortedKeys);
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * JSON.stringify replacer that sorts object keys for stable serialization.
 * Prevents cache misses caused by key ordering differences.
 */
function sortedKeys(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b)
      )
    );
  }
  return value;
}
