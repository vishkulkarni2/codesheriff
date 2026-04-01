/**
 * Webhook payload types for GitHub, GitLab, and Bitbucket.
 * These represent the normalized structures after parsing raw webhook bodies.
 */

import type { Provider, ScanTrigger } from './enums.js';

// ---------------------------------------------------------------------------
// Normalized webhook event (provider-agnostic)
// ---------------------------------------------------------------------------

export interface NormalizedWebhookEvent {
  provider: Provider;
  trigger: ScanTrigger;
  repoFullName: string;
  repoId: string;
  branch: string;
  commitSha: string;
  prNumber: number | null;
  prTitle: string | null;
  authorLogin: string | null;
  /** Raw installation/app ID for re-authentication */
  installationId: string | null;
}

// ---------------------------------------------------------------------------
// GitHub webhook shapes (subset of fields we care about)
// ---------------------------------------------------------------------------

export interface GitHubPRPayload {
  action: 'opened' | 'synchronize' | 'reopened' | 'closed';
  number: number;
  pull_request: {
    title: string;
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
    user: { login: string };
  };
  repository: {
    id: number;
    full_name: string;
    default_branch: string;
    private: boolean;
  };
  installation: { id: number } | null;
}

export interface GitHubPushPayload {
  ref: string; // e.g. "refs/heads/main"
  after: string; // commit SHA
  repository: {
    id: number;
    full_name: string;
    default_branch: string;
    private: boolean;
  };
  pusher: { name: string };
  installation: { id: number } | null;
}

// ---------------------------------------------------------------------------
// BullMQ job payload (what we enqueue after parsing a webhook)
// ---------------------------------------------------------------------------

export interface ScanJobPayload {
  scanId: string;
  repositoryId: string;
  repoFullName: string;
  provider: Provider;
  branch: string;
  commitSha: string;
  prNumber: number | null;
  prTitle: string | null;
  installationId: string | null;
  /** ISO timestamp of when the job was enqueued */
  enqueuedAt: string;
}

// ---------------------------------------------------------------------------
// GitHub Check Run shapes
// ---------------------------------------------------------------------------

export interface CheckRunOutput {
  title: string;
  summary: string;
  text?: string;
  annotations?: CheckRunAnnotation[];
}

export interface CheckRunAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  message: string;
  title?: string;
}
