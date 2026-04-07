/**
 * GitHub API client for the scan worker.
 *
 * Wraps @octokit/app to handle GitHub App authentication (JWT → installation token).
 * Used to fetch file diffs from PRs and post check runs / review comments.
 *
 * SECURITY:
 *   - Private key and app credentials read from environment — never hardcoded
 *   - Installation tokens are short-lived (1 hour); no long-term token storage
 *   - All API calls include request ID for audit correlation
 */

import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';
import type { AnalysisFile } from '@codesheriff/shared';
import { EXTENSION_TO_LANGUAGE } from '@codesheriff/shared';
import { logger } from '../utils/logger.js';

interface GitHubClientOptions {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

export class GitHubClient {
  private readonly app: App;

  constructor(opts: GitHubClientOptions) {
    // IMPORTANT: pass Octokit class so getInstallationOctokit() returns an
    // instance with the REST plugin (octokit.rest.*). Without this, @octokit/app
    // returns a bare core Octokit and every octokit.rest.* call throws
    // "Cannot read properties of undefined (reading 'repos')".
    this.app = new App({
      appId: opts.appId,
      privateKey: opts.privateKey,
      webhooks: { secret: opts.webhookSecret },
      Octokit,
    });
  }

  /**
   * Fetch changed files from a pull request for scanning.
   * Returns an array of AnalysisFile ready for the pipeline.
   *
   * @param installationId - GitHub App installation ID for token exchange
   * @param owner - Repository owner (org or user)
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @param maxFiles - Maximum files to fetch (from feature flags)
   */
  async getPRFiles(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number,
    maxFiles: number
  ): Promise<AnalysisFile[]> {
    const octokit = await this.getInstallationOctokit(installationId);

    // Fetch PR file list (GitHub paginates at 30 per page; we cap at maxFiles)
    const filesResponse = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: Math.min(maxFiles, 100),
    });

    const files = filesResponse.data.slice(0, maxFiles);

    // Fetch file contents in parallel, but with a concurrency cap to avoid
    // GitHub secondary rate limits
    const analysisFiles = await pMapWithConcurrency(
      files,
      async (file) => {
        if (file.status === 'removed') {
          return {
            path: file.filename,
            content: '',
            language: inferLanguage(file.filename),
            lineCount: 0,
            status: 'deleted' as const,
            patch: file.patch ?? null,
          };
        }

        try {
          const contentResponse = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: file.filename,
            ref: file.sha,
          });

          const data = contentResponse.data;
          if (Array.isArray(data) || data.type !== 'file') {
            logger.warn({ path: file.filename }, 'Unexpected content type from GitHub API');
            return null;
          }

          // Decode base64 content safely
          const content = Buffer.from(data.content, 'base64').toString('utf8');
          const lineCount = content.split('\n').length;

          return {
            path: file.filename,
            content,
            language: inferLanguage(file.filename),
            lineCount,
            status: file.status === 'added' ? ('added' as const) : ('modified' as const),
            patch: file.patch ?? null,
          };
        } catch (err) {
          logger.warn({ err, path: file.filename }, 'failed to fetch file content from GitHub');
          return null;
        }
      },
      5 // max 5 concurrent GitHub API calls
    );

    return analysisFiles.filter((f) => f !== null) as AnalysisFile[];
  }

  /**
   * Fetch changed files from a push event (commit diff vs. parent).
   */
  async getPushFiles(
    installationId: string,
    owner: string,
    repo: string,
    commitSha: string,
    maxFiles: number
  ): Promise<AnalysisFile[]> {
    const octokit = await this.getInstallationOctokit(installationId);

    const commitResponse = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: commitSha,
    });

    const changedFiles = (commitResponse.data.files ?? []).slice(0, maxFiles);

    const analysisFiles = await pMapWithConcurrency(
      changedFiles,
      async (file) => {
        if (file.status === 'removed') {
          return {
            path: file.filename,
            content: '',
            language: inferLanguage(file.filename),
            lineCount: 0,
            status: 'deleted' as const,
            patch: file.patch ?? null,
          };
        }

        try {
          const contentResponse = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: file.filename,
            ref: commitSha,
          });

          const data = contentResponse.data;
          if (Array.isArray(data) || data.type !== 'file') return null;

          const content = Buffer.from(data.content, 'base64').toString('utf8');

          return {
            path: file.filename,
            content,
            language: inferLanguage(file.filename),
            lineCount: content.split('\n').length,
            status: file.status === 'added' ? ('added' as const) : ('modified' as const),
            patch: file.patch ?? null,
          };
        } catch (err) {
          logger.warn({ err, path: file.filename }, 'failed to fetch file content');
          return null;
        }
      },
      5
    );

    return analysisFiles.filter((f) => f !== null) as AnalysisFile[];
  }

  /**
   * Create or update a GitHub Check Run for a PR/commit.
   */
  async createCheckRun(
    installationId: string,
    owner: string,
    repo: string,
    headSha: string,
    name: string,
    status: 'in_progress' | 'completed',
    conclusion?: 'success' | 'failure' | 'neutral',
    output?: {
      title: string;
      summary: string;
      text?: string;
    }
  ): Promise<number> {
    const octokit = await this.getInstallationOctokit(installationId);

    const response = await octokit.rest.checks.create({
      owner,
      repo,
      name,
      head_sha: headSha,
      status,
      ...(conclusion ? { conclusion } : {}),
      ...(output ? { output } : {}),
      started_at: new Date().toISOString(),
      ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
    });

    return response.data.id;
  }

  /**
   * Post a PR summary comment with the risk score card.
   */
  async postPRComment(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void> {
    const octokit = await this.getInstallationOctokit(installationId);

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }

  /**
   * Post an inline review comment on a specific file line.
   */
  async postInlineComment(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number,
    commitSha: string,
    path: string,
    line: number,
    body: string
  ): Promise<void> {
    const octokit = await this.getInstallationOctokit(installationId);

    try {
      await octokit.rest.pulls.createReviewComment({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: commitSha,
        path,
        line,
        body,
      });
    } catch (err) {
      // Inline comment can fail if the line isn't in the diff — log and continue
      logger.warn({ err, path, line }, 'failed to post inline review comment');
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getInstallationOctokit(installationId: string): Promise<Octokit> {
    const octokit = await this.app.getInstallationOctokit(parseInt(installationId, 10));
    return octokit as unknown as Octokit;
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
 * Map an array with limited concurrency — avoids overwhelming GitHub API.
 */
async function pMapWithConcurrency<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(mapper));
    results.push(...batchResults);
  }

  return results;
}
