/**
 * Shared constants used across all CodeSheriff services.
 */

// ---------------------------------------------------------------------------
// BullMQ queue names
// ---------------------------------------------------------------------------

export const QUEUE_NAMES = {
  SCAN: 'scan',
  NOTIFICATIONS: 'notifications',
  REPORT_EXPORT: 'report-export',
  DIGEST: 'digest',
} as const;

// ---------------------------------------------------------------------------
// Redis key prefixes
// ---------------------------------------------------------------------------

export const REDIS_KEYS = {
  /** LLM response cache: `llm_cache:<sha256_of_input>` */
  LLM_CACHE: 'llm_cache',
  /** Scan status pub/sub channel: `scan_status:<scanId>` */
  SCAN_STATUS: 'scan_status',
  /** Rate limit counter: `rate_limit:<orgId>:<endpoint>` */
  RATE_LIMIT: 'rate_limit',
} as const;

// ---------------------------------------------------------------------------
// Risk score thresholds
// ---------------------------------------------------------------------------

export const RISK_THRESHOLDS = {
  /** Below this = low risk (green) */
  LOW: 25,
  /** Below this = medium risk (yellow) */
  MEDIUM: 50,
  /** Below this = high risk (orange) */
  HIGH: 75,
  /** At or above = critical risk (red) */
  CRITICAL: 75,
} as const;

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export function getRiskLevel(score: number): RiskLevel {
  if (score < RISK_THRESHOLDS.LOW) return 'low';
  if (score < RISK_THRESHOLDS.MEDIUM) return 'medium';
  if (score < RISK_THRESHOLDS.CRITICAL) return 'high';
  return 'critical';
}

// ---------------------------------------------------------------------------
// Plan limits
// ---------------------------------------------------------------------------

export const PLAN_LIMITS = {
  FREE: {
    seats: 3,
    scansPerMonth: 500,
    privateRepos: false,
    customRules: false,
    sarifExport: false,
    sso: false,
  },
  TEAM: {
    seats: Infinity,
    scansPerMonth: Infinity,
    privateRepos: true,
    customRules: true,
    sarifExport: true,
    sso: false,
  },
  ENTERPRISE: {
    seats: Infinity,
    scansPerMonth: Infinity,
    privateRepos: true,
    customRules: true,
    sarifExport: true,
    sso: true,
  },
} as const;

// ---------------------------------------------------------------------------
// Supported languages for analysis
// ---------------------------------------------------------------------------

export const SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'go',
  'java',
  'ruby',
  'php',
  'rust',
  'csharp',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// ---------------------------------------------------------------------------
// File extension → language mapping
// ---------------------------------------------------------------------------

export const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.rs': 'rust',
  '.cs': 'csharp',
};

// ---------------------------------------------------------------------------
// Analysis pipeline
// ---------------------------------------------------------------------------

export const PIPELINE_DEFAULTS = {
  /** LLM call timeout in milliseconds */
  LLM_TIMEOUT_MS: 30_000,
  /** Max retries for LLM calls */
  LLM_MAX_RETRIES: 3,
  /** Base delay for exponential backoff (ms) */
  LLM_BACKOFF_BASE_MS: 1_000,
  /** Semgrep subprocess timeout (ms) */
  SEMGREP_TIMEOUT_MS: 60_000,
  /** TruffleHog subprocess timeout (ms) */
  TRUFFLEHOG_TIMEOUT_MS: 60_000,
  /** Minimum LLM confidence to emit a hallucination finding */
  HALLUCINATION_MIN_CONFIDENCE: 0.7,
} as const;

// ---------------------------------------------------------------------------
// GitHub App
// ---------------------------------------------------------------------------

export const GITHUB = {
  /** Minimum severity to post inline review comments */
  INLINE_COMMENT_MIN_SEVERITY: 'HIGH',
  /** Checks API conclusion values */
  CHECK_CONCLUSION: {
    SUCCESS: 'success',
    FAILURE: 'failure',
    NEUTRAL: 'neutral',
    CANCELLED: 'cancelled',
  },
} as const;
