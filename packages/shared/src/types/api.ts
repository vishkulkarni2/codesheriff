/**
 * API request/response types for the CodeSheriff REST API.
 * All endpoints return the standard ApiResponse<T> envelope.
 */

import type { Finding, Organization, Repository, Rule, Scan, User } from './models.js';
import type { FindingCategory, Plan, Severity } from './enums.js';

// ---------------------------------------------------------------------------
// Standard API envelope
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: ApiMeta;
}

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Scan endpoints
// ---------------------------------------------------------------------------

export interface CreateScanRequest {
  repositoryId: string;
  commitSha: string;
  branch: string;
  prNumber?: number;
  prTitle?: string;
}

export interface CreateScanResponse {
  scanId: string;
  status: string;
}

export interface ScanWithFindings extends Scan {
  findings: Finding[];
  repository: Pick<Repository, 'id' | 'name' | 'fullName' | 'provider'>;
}

// ---------------------------------------------------------------------------
// Dashboard endpoints
// ---------------------------------------------------------------------------

export type DashboardPeriod = '7d' | '30d' | '90d';

export interface DashboardQuery {
  orgId: string;
  period: DashboardPeriod;
}

export interface DashboardStats {
  orgRiskScore: number;
  scansThisMonth: number;
  criticalFindings: number;
  falsePositiveRate: number;
  findingsTrend: DailyFindingCount[];
  topRiskyRepos: RepositoryRiskSummary[];
  recentScans: RecentScanEntry[];
  findingsByCategory: CategoryBreakdown[];
}

export interface DailyFindingCount {
  date: string; // ISO date string YYYY-MM-DD
  count: number;
  critical: number;
  high: number;
}

export interface RepositoryRiskSummary {
  id: string;
  name: string;
  fullName: string;
  riskScore: number;
  criticalCount: number;
  highCount: number;
  lastScannedAt: string | null;
}

export interface RecentScanEntry {
  id: string;
  repositoryName: string;
  status: string;
  riskScore: number | null;
  findingsCount: number;
  createdAt: string;
}

export interface CategoryBreakdown {
  category: FindingCategory;
  count: number;
  percentage: number;
}

// ---------------------------------------------------------------------------
// Findings endpoints
// ---------------------------------------------------------------------------

export interface FindingsQuery extends PaginationQuery {
  repoId?: string;
  severity?: Severity;
  category?: FindingCategory;
  isAISpecific?: boolean;
  falsePositive?: boolean;
  suppressed?: boolean;
}

export interface UpdateFindingRequest {
  falsePositive?: boolean;
  suppressed?: boolean;
}

// ---------------------------------------------------------------------------
// Repository endpoints
// ---------------------------------------------------------------------------

export interface RiskHistoryEntry {
  date: string; // ISO date string
  riskScore: number;
}

// ---------------------------------------------------------------------------
// Org & User endpoints
// ---------------------------------------------------------------------------

export interface OrgWithUsers extends Organization {
  users: User[];
  repositories: Pick<Repository, 'id' | 'name' | 'riskScore'>[];
}

export interface UpdateOrgRequest {
  name?: string;
  plan?: Plan;
  seats?: number;
}

// ---------------------------------------------------------------------------
// Rules endpoints
// ---------------------------------------------------------------------------

export interface CreateRuleRequest {
  name: string;
  description: string;
  semgrepPattern: string;
  severity: Severity;
  category: FindingCategory;
  isAISpecific?: boolean;
}

export interface UpdateRuleRequest {
  name?: string;
  description?: string;
  semgrepPattern?: string;
  severity?: Severity;
  category?: FindingCategory;
  isEnabled?: boolean;
  isAISpecific?: boolean;
}

export interface TestRuleRequest {
  semgrepPattern: string;
  codeSnippet: string;
  language: string;
}

export interface TestRuleResponse {
  matches: TestRuleMatch[];
}

export interface TestRuleMatch {
  line: number;
  column: number;
  snippet: string;
}
