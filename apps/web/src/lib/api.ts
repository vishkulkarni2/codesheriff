/**
 * Typed API client for the CodeSheriff Fastify backend.
 *
 * All requests attach the Clerk session token as Bearer in Authorization.
 * Token is fetched from Clerk's getToken() — never decoded client-side.
 *
 * SECURITY:
 *   - Never use jwt.decode() on the client — tokens are opaque here
 *   - All organizationId scoping is enforced server-side
 *   - This module only constructs fetch calls; no auth logic lives here
 */

import type {
  ApiResponse,
  DashboardStats,
  RecentScanEntry,
  ScanWithFindings,
  Repository,
  Rule,
} from '@codesheriff/shared';
import type { Finding } from '@codesheriff/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

// ---------------------------------------------------------------------------
// Internal fetch wrapper
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<ApiResponse<T>> {
  // cache: 'no-store' is critical: this client is used by both server
  // components and client polling. Next.js 14 fetch() caches by default
  // in server components, which makes router.refresh() return stale data
  // and breaks the live scan progress / findings auto-update flow.
  const res = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });

  const body: unknown = await res.json();
  return body as ApiResponse<T>;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function getDashboard(token: string): Promise<ApiResponse<DashboardStats>> {
  return apiFetch<DashboardStats>('/dashboard', token);
}

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

export async function listScans(
  token: string,
  params: { repositoryId?: string; page?: number; limit?: number } = {}
): Promise<ApiResponse<{ scans: RecentScanEntry[]; total: number }>> {
  const qs = new URLSearchParams();
  if (params.repositoryId) qs.set('repositoryId', params.repositoryId);
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch(`/scans${query}`, token);
}

export async function getScan(
  token: string,
  scanId: string,
  params: { page?: number; limit?: number; severity?: string; category?: string } = {}
): Promise<ApiResponse<ScanWithFindings>> {
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.severity) qs.set('severity', params.severity);
  if (params.category) qs.set('category', params.category);
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<ScanWithFindings>(`/scans/${encodeURIComponent(scanId)}${query}`, token);
}

export async function triggerScan(
  token: string,
  body: { repositoryId: string; branch: string; commitSha?: string; prNumber?: number; prTitle?: string }
): Promise<ApiResponse<{ scanId: string; status: string }>> {
  // Only include commitSha in the request body if the caller actually provided one.
  // The backend resolves the branch HEAD when commitSha is omitted.
  const payload: Record<string, unknown> = {
    repositoryId: body.repositoryId,
    branch: body.branch,
  };
  if (body.commitSha) payload.commitSha = body.commitSha;
  if (body.prNumber !== undefined) payload.prNumber = body.prNumber;
  if (body.prTitle !== undefined) payload.prTitle = body.prTitle;
  return apiFetch('/scans', token, { method: 'POST', body: JSON.stringify(payload) });
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export async function suppressFinding(
  token: string,
  findingId: string,
  reason: string
): Promise<ApiResponse<Finding>> {
  return apiFetch<Finding>(`/findings/${encodeURIComponent(findingId)}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ suppressed: true, suppressionReason: reason }),
  });
}

export async function markFalsePositive(
  token: string,
  findingId: string
): Promise<ApiResponse<Finding>> {
  return apiFetch<Finding>(`/findings/${encodeURIComponent(findingId)}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ falsePositive: true }),
  });
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export async function listRepos(token: string): Promise<ApiResponse<Repository[]>> {
  return apiFetch('/repos', token);
}

export async function getRepo(token: string, repoId: string): Promise<ApiResponse<Repository>> {
  return apiFetch(`/repos/${encodeURIComponent(repoId)}`, token);
}

export interface RepoBranches {
  defaultBranch: string;
  branches: string[];
  /** True when the API could not enumerate the full list (degraded fallback) */
  partial: boolean;
}

export async function listRepoBranches(
  token: string,
  repoId: string
): Promise<ApiResponse<RepoBranches>> {
  return apiFetch<RepoBranches>(`/repos/${encodeURIComponent(repoId)}/branches`, token);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export async function listRules(token: string): Promise<ApiResponse<Rule[]>> {
  return apiFetch('/rules', token);
}

export async function createRule(
  token: string,
  body: { name: string; description: string; pattern: string; language: string; severity: string }
): Promise<ApiResponse<Rule>> {
  return apiFetch('/rules', token, { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteRule(token: string, ruleId: string): Promise<ApiResponse<null>> {
  return apiFetch(`/rules/${encodeURIComponent(ruleId)}`, token, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Organization settings
// ---------------------------------------------------------------------------

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  plan: string;
  seats: number;
  slackWebhookUrl: string | null;
  githubInstallationId: string | null;
  gitlabGroupId: string | null;
  updatedAt: string;
}

export async function getOrgSettings(token: string): Promise<ApiResponse<OrgSettings>> {
  return apiFetch<OrgSettings>('/orgs/current', token);
}

export async function updateOrgSettings(
  token: string,
  data: { name?: string; slackWebhookUrl?: string | null }
): Promise<ApiResponse<OrgSettings>> {
  return apiFetch<OrgSettings>('/orgs/current', token, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// GitLab VCS connection
// ---------------------------------------------------------------------------

export interface GitLabVcsStatus {
  connected: boolean;
  configuredAt: string | null;
  tokenExpiresAt: string | null;
}

export async function getGitLabVcsStatus(token: string): Promise<ApiResponse<GitLabVcsStatus>> {
  return apiFetch<GitLabVcsStatus>('/orgs/current/vcs/gitlab', token);
}

// ---------------------------------------------------------------------------
// GitHub manual sync
// ---------------------------------------------------------------------------

export interface GitHubSyncResult {
  installationId: string;
  syncedRepos: string[];
  count: number;
}

export async function syncGitHubRepos(
  token: string,
  installationId?: number
): Promise<ApiResponse<GitHubSyncResult>> {
  return apiFetch<GitHubSyncResult>('/orgs/current/vcs/github/sync', token, {
    method: 'POST',
    body: JSON.stringify(installationId ? { installation_id: installationId } : {}),
  });
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export interface BillingStatus {
  plan: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
  planUpdatedAt: string | null;
}

export async function getBillingStatus(token: string): Promise<ApiResponse<BillingStatus>> {
  return apiFetch<BillingStatus>('/billing/status', token);
}

export interface CancelResult {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number;
}

export async function cancelSubscription(token: string): Promise<ApiResponse<CancelResult>> {
  return apiFetch<CancelResult>('/billing/cancel', token, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// SARIF export
// ---------------------------------------------------------------------------

/**
 * Downloads the SARIF 2.1.0 export for a scan.
 *
 * Returns the raw `Response` so callers can read it as a Blob and trigger a
 * browser download without losing the auth header. The backend sets
 * Content-Disposition: attachment so the filename is also carried along.
 */
export async function getScanSarif(token: string, scanId: string): Promise<Response> {
  return fetch(`${API_BASE}/scans/${encodeURIComponent(scanId)}/sarif`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
