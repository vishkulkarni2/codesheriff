/**
 * GitLab API client for the scan worker.
 *
 * Fetches changed files from merge requests and push commits using the
 * GitLab REST API v4. Supports both gitlab.com and self-hosted instances.
 *
 * Auth model: Personal Access Token or Group Access Token stored encrypted
 * in VcsInstallation — passed as PRIVATE-TOKEN header per request.
 *
 * SECURITY:
 *   - Token is passed per-call — never stored on the client instance
 *   - Project paths are URL-encoded before use in API URLs
 *   - File content is fetched by SHA ref — prevents branch-swapping attacks
 *   - Concurrency-capped to avoid GitLab secondary rate limits
 *   - AbortSignal.timeout() prevents hung requests from blocking the worker
 */

import type { AnalysisFile } from '@codesheriff/shared';
import { EXTENSION_TO_LANGUAGE } from '@codesheriff/shared';
import { logger } from '../utils/logger.js';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_FILE_FETCHES = 5;

// ---------------------------------------------------------------------------
// GitLab API response shapes (subset of fields we care about)
// ---------------------------------------------------------------------------

interface GitLabDiffFile {
  old_path: string;
  new_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  diff: string;
}

interface GitLabMRChangesResponse {
  diff_refs: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  };
  changes: GitLabDiffFile[];
}

// ---------------------------------------------------------------------------
// GitLabClient
// ---------------------------------------------------------------------------

export class GitLabClient {
  private readonly apiBase: string;

  /**
   * @param baseUrl - GitLab instance base URL.
   *   Defaults to https://gitlab.com — override for self-hosted instances
   *   via GITLAB_BASE_URL env var.
   */
  constructor(baseUrl = 'https://gitlab.com') {
    this.apiBase = `${baseUrl.replace(/\/$/, '')}/api/v4`;
  }

  /**
   * Fetch changed files from a Merge Request for scanning.
   *
   * Strategy:
   *   1. GET /projects/:id/merge_requests/:iid/changes  → file list + diffs
   *   2. For each non-deleted file, GET /projects/:id/repository/files/:path/raw?ref=:sha
   *
   * @param token       - Decrypted personal/group access token
   * @param projectPath - Namespace + repo, e.g. "acme/backend-api"
   * @param mrIid       - MR internal ID (the number shown in the GitLab UI)
   * @param commitSha   - Head commit SHA of the MR branch (for file content ref)
   * @param maxFiles    - Cap from feature flags
   */
  async getMRFiles(
    token: string,
    projectPath: string,
    mrIid: number,
    commitSha: string,
    maxFiles: number
  ): Promise<AnalysisFile[]> {
    const encodedProject = encodeURIComponent(projectPath);

    const changesUrl = `${this.apiBase}/projects/${encodedProject}/merge_requests/${mrIid}/changes`;
    const changesRes = await this.fetch<GitLabMRChangesResponse>(changesUrl, token);

    const files = changesRes.changes.slice(0, maxFiles);
    logger.debug({ project: projectPath, mrIid, fileCount: files.length }, 'GitLab MR file list fetched');

    return this.fetchFileContents(token, encodedProject, commitSha, files);
  }

  /**
   * Fetch changed files from a push (commit diff vs. its parent).
   *
   * Strategy:
   *   1. GET /projects/:id/repository/commits/:sha/diff  → file list + diffs
   *   2. For each non-deleted file, GET /projects/:id/repository/files/:path/raw?ref=:sha
   */
  async getPushFiles(
    token: string,
    projectPath: string,
    commitSha: string,
    maxFiles: number
  ): Promise<AnalysisFile[]> {
    const encodedProject = encodeURIComponent(projectPath);

    const diffUrl = `${this.apiBase}/projects/${encodedProject}/repository/commits/${commitSha}/diff`;
    const diffFiles = await this.fetch<GitLabDiffFile[]>(diffUrl, token);

    const files = diffFiles.slice(0, maxFiles);
    logger.debug({ project: projectPath, commitSha, fileCount: files.length }, 'GitLab push diff fetched');

    return this.fetchFileContents(token, encodedProject, commitSha, files);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve file list to AnalysisFile[] — fetches content for all non-deleted
   * files with bounded concurrency.
   */
  private async fetchFileContents(
    token: string,
    encodedProject: string,
    ref: string,
    files: GitLabDiffFile[]
  ): Promise<AnalysisFile[]> {
    const results = await pMapWithConcurrency(
      files,
      async (file): Promise<AnalysisFile | null> => {
        const filePath = file.new_file || file.renamed_file ? file.new_path : file.old_path;
        const language = inferLanguage(filePath);

        if (file.deleted_file) {
          return {
            path: filePath,
            content: '',
            language,
            lineCount: 0,
            status: 'deleted',
            patch: file.diff || null,
          };
        }

        try {
          // GitLab requires the file path to be percent-encoded (/ → %2F)
          const encodedPath = file.new_path
            .split('/')
            .map(encodeURIComponent)
            .join('%2F');

          const rawUrl =
            `${this.apiBase}/projects/${encodedProject}/repository/files` +
            `/${encodedPath}/raw?ref=${encodeURIComponent(ref)}`;

          const content = await this.fetchRaw(rawUrl, token);
          const lineCount = content.split('\n').length;

          return {
            path: file.new_path,
            content,
            language,
            lineCount,
            status: file.new_file ? 'added' : 'modified',
            patch: file.diff || null,
          };
        } catch (err) {
          logger.warn({ err, path: file.new_path }, 'GitLab: failed to fetch file content');
          return null;
        }
      },
      MAX_CONCURRENT_FILE_FETCHES
    );

    return results.filter((f): f is AnalysisFile => f !== null);
  }

  /** Fetch JSON from a GitLab API endpoint with auth. */
  private async fetch<T>(url: string, token: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        'PRIVATE-TOKEN': token,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new GitLabApiError(res.status, url, await res.text().catch(() => ''));
    }

    return res.json() as Promise<T>;
  }

  /** Fetch raw file content (plain text, not JSON). */
  private async fetchRaw(url: string, token: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': token },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new GitLabApiError(res.status, url, await res.text().catch(() => ''));
    }

    return res.text();
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class GitLabApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(`GitLab API error ${statusCode} for ${url}`);
    this.name = 'GitLabApiError';
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function inferLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'));
  return EXTENSION_TO_LANGUAGE[ext] ?? 'unknown';
}

/**
 * Run an async mapper over an array with a max concurrency cap.
 * Identical to the helper in github-client.ts — kept local to avoid coupling.
 */
async function pMapWithConcurrency<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(mapper)));
  }
  return results;
}
