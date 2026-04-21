/**
 * Repo-level config loader — parses `.codesheriff.yml` from the repo root.
 *
 * Philosophy:
 *   - This is the first customer-facing config surface; future settings
 *     (rules, severity overrides, auto-fix knobs, ignore globs) will extend
 *     this same file.
 *   - Never fail a scan because of a bad config. Missing / malformed /
 *     validation-failed → warn + fall back to defaults.
 *   - Unknown keys are logged but accepted — users won't have their scans
 *     break when they upgrade.
 *
 * Resolution order (scan-processor.ts):
 *   config-from-file > env var > built-in default
 */
import yaml from 'js-yaml';
import type { Logger } from 'pino';
import type { AnalysisFile } from '@codesheriff/shared';

export type InlineSeverityThreshold = 'all' | 'high' | 'critical' | 'none';

export interface RepoConfig {
  comments: {
    inlineSeverityThreshold: InlineSeverityThreshold;
    inlineLowCap: number;
    summaryTopN: number;
  };
}

export const CONFIG_FILE_NAME = '.codesheriff.yml';
export const CONFIG_FILE_NAME_ALT = '.codesheriff.yaml';

const VALID_THRESHOLDS = new Set<InlineSeverityThreshold>([
  'all',
  'high',
  'critical',
  'none',
]);

const KNOWN_COMMENT_KEYS = new Set([
  'inline_severity_threshold',
  'inline_low_cap',
  'summary_top_n',
]);
const KNOWN_TOP_LEVEL_KEYS = new Set(['comments']);

/**
 * Built-in defaults. Used when no config file is present, when parsing
 * fails, or per-field when a value fails validation.
 */
export function defaultRepoConfig(
  envInlineLowCap?: number | undefined,
): RepoConfig {
  return {
    comments: {
      inlineSeverityThreshold: 'high',
      inlineLowCap: envInlineLowCap ?? 20,
      summaryTopN: 10,
    },
  };
}

/**
 * Find `.codesheriff.yml` (or `.yaml`) at the root of the fetched file set.
 * Returns null if absent.
 */
export function findConfigFile(
  files: Pick<AnalysisFile, 'path' | 'content'>[],
): Pick<AnalysisFile, 'path' | 'content'> | null {
  return (
    files.find((f) => f.path === CONFIG_FILE_NAME) ??
    files.find((f) => f.path === CONFIG_FILE_NAME_ALT) ??
    null
  );
}

/**
 * Parse raw YAML text into a validated RepoConfig. Failures are logged and
 * the default is returned — this function never throws.
 */
export function parseRepoConfig(
  rawYaml: string,
  log: Logger,
  envInlineLowCap?: number | undefined,
): RepoConfig {
  const defaults = defaultRepoConfig(envInlineLowCap);

  let parsed: unknown;
  try {
    parsed = yaml.load(rawYaml);
  } catch (err) {
    log.warn({ err }, `.codesheriff.yml: malformed YAML, using defaults`);
    return defaults;
  }

  if (parsed == null) return defaults;

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    log.warn(
      { type: Array.isArray(parsed) ? 'array' : typeof parsed },
      `.codesheriff.yml: expected an object at the top level, using defaults`,
    );
    return defaults;
  }

  const root = parsed as Record<string, unknown>;

  for (const key of Object.keys(root)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      log.warn(
        { key },
        `.codesheriff.yml: unknown key "${key}" at top level, ignoring`,
      );
    }
  }

  const commentsRaw = root['comments'];
  if (commentsRaw == null) return defaults;

  if (typeof commentsRaw !== 'object' || Array.isArray(commentsRaw)) {
    log.warn(
      `.codesheriff.yml: "comments" must be an object, using defaults for comment settings`,
    );
    return defaults;
  }

  const comments = commentsRaw as Record<string, unknown>;
  const result = { ...defaults.comments };

  for (const key of Object.keys(comments)) {
    if (!KNOWN_COMMENT_KEYS.has(key)) {
      log.warn(
        { key },
        `.codesheriff.yml: unknown key "comments.${key}", ignoring`,
      );
    }
  }

  // inline_severity_threshold
  if ('inline_severity_threshold' in comments) {
    const v = comments['inline_severity_threshold'];
    if (
      typeof v === 'string' &&
      VALID_THRESHOLDS.has(v as InlineSeverityThreshold)
    ) {
      result.inlineSeverityThreshold = v as InlineSeverityThreshold;
    } else {
      log.warn(
        { value: v },
        `.codesheriff.yml: invalid "comments.inline_severity_threshold" — ` +
          `must be one of all|high|critical|none, using default "${defaults.comments.inlineSeverityThreshold}"`,
      );
    }
  }

  // inline_low_cap
  if ('inline_low_cap' in comments) {
    const v = comments['inline_low_cap'];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000) {
      result.inlineLowCap = Math.floor(v);
    } else {
      log.warn(
        { value: v },
        `.codesheriff.yml: invalid "comments.inline_low_cap" — ` +
          `must be a number in [0, 1000], using default ${defaults.comments.inlineLowCap}`,
      );
    }
  }

  // summary_top_n
  if ('summary_top_n' in comments) {
    const v = comments['summary_top_n'];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 100) {
      result.summaryTopN = Math.floor(v);
    } else {
      log.warn(
        { value: v },
        `.codesheriff.yml: invalid "comments.summary_top_n" — ` +
          `must be a number in [1, 100], using default ${defaults.comments.summaryTopN}`,
      );
    }
  }

  return { comments: result };
}

/**
 * Convenience wrapper: look up the config file inside the fetched file list,
 * parse it, and return a RepoConfig. Always returns something usable.
 */
export function loadRepoConfigFromFiles(
  files: Pick<AnalysisFile, 'path' | 'content'>[],
  log: Logger,
  envInlineLowCap?: number | undefined,
): RepoConfig {
  const file = findConfigFile(files);
  if (!file) return defaultRepoConfig(envInlineLowCap);

  log.info({ path: file.path }, 'repo config file found, parsing');
  return parseRepoConfig(file.content, log, envInlineLowCap);
}
