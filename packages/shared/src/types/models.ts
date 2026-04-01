/**
 * TypeScript interfaces mirroring the Prisma database models.
 * Used throughout the API, worker, and frontend for consistent typing.
 */

import type {
  Plan,
  UserRole,
  Provider,
  ScanTrigger,
  ScanStatus,
  Severity,
  FindingCategory,
} from './enums.js';

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export interface Organization {
  id: string;
  name: string;
  /** URL-safe unique slug, e.g. "acme-corp" */
  slug: string;
  plan: Plan;
  /** Number of purchased seats */
  seats: number;
  githubInstallationId: string | null;
  gitlabGroupId: string | null;
  bitbucketWorkspace: string | null;
  /** Slack incoming webhook URL for post-scan notifications */
  slackWebhookUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  /** Clerk user ID (external auth provider ID) */
  clerkId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  organizationId: string;
  role: UserRole;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface Repository {
  id: string;
  organizationId: string;
  name: string;
  /** Full repository name, e.g. "org/repo" */
  fullName: string;
  provider: Provider;
  defaultBranch: string;
  isPrivate: boolean;
  /** Primary detected language */
  language: string | null;
  /** Latest computed risk score (0–100) */
  riskScore: number | null;
  lastScannedAt: Date | null;
  /** VCS-side webhook ID for deregistration */
  webhookId: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export interface Scan {
  id: string;
  repositoryId: string;
  triggeredBy: ScanTrigger;
  prNumber: number | null;
  prTitle: string | null;
  branch: string;
  commitSha: string;
  status: ScanStatus;
  /** Computed risk score 0–100 */
  riskScore: number | null;
  findingsCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  /** Wall-clock duration in milliseconds */
  durationMs: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Finding
// ---------------------------------------------------------------------------

export interface Finding {
  id: string;
  scanId: string;
  repositoryId: string;
  /** Reference to the Rule that triggered this finding (nullable for ad-hoc LLM findings) */
  ruleId: string | null;
  title: string;
  description: string;
  /** AI-generated plain-English explanation of the issue */
  explanation: string | null;
  /** AI-generated copy-pasteable remediation code */
  remediation: string | null;
  severity: Severity;
  category: FindingCategory;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  codeSnippet: string;
  /** True when finding matches an AI-code-specific anti-pattern */
  isAIPatternSpecific: boolean;
  falsePositive: boolean;
  suppressed: boolean;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

export interface Rule {
  id: string;
  /** null = global built-in rule; set = org-specific custom rule */
  organizationId: string | null;
  name: string;
  description: string;
  /** Raw semgrep YAML pattern string */
  semgrepPattern: string;
  isEnabled: boolean;
  severity: Severity;
  category: FindingCategory;
  /** True when rule specifically targets AI code anti-patterns */
  isAISpecific: boolean;
  createdAt: Date;
}
