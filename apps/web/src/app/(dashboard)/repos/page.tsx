/**
 * Repositories list page — shows all repos connected to the org.
 *
 * Displays risk score, language, default branch, and last-scanned time
 * for each repo. Sorted by risk score descending so the most dangerous
 * repo is always at the top.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { listRepos } from '@/lib/api';
import { RiskScoreRing } from '@/components/shared/risk-score-ring';
import { timeAgo } from '@/lib/utils';
import Link from 'next/link';
import { GitBranch, Globe, Lock, Unlock, AlertCircle } from 'lucide-react';
import type { Repository } from '@codesheriff/shared';

export const metadata = { title: 'Repositories' };

export default async function ReposPage() {
  const { getToken, userId } = auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  if (!token) redirect('/sign-in');

  const { data: repos, error } = await listRepos(token);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="font-medium">Failed to load repositories</p>
          <p className="text-sm text-muted-foreground">Please refresh the page.</p>
        </div>
      </div>
    );
  }

  // Sort by risk score descending — highest risk at top
  const sorted = [...(repos ?? [])].sort(
    (a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0)
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Repositories</h1>
          <p className="text-sm text-muted-foreground">
            {sorted.length} {sorted.length === 1 ? 'repository' : 'repositories'} connected
          </p>
        </div>
      </div>

      {/* Empty state */}
      {sorted.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-xl border bg-card py-20 text-center">
          <GitBranch className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-medium">No repositories connected</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Install the CodeSheriff GitHub App on your repositories to get started.
            </p>
          </div>
          <a
            href="https://github.com/apps/codesheriff"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Install GitHub App
          </a>
        </div>
      )}

      {/* Repo grid */}
      {sorted.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((repo) => (
            <RepoCard key={repo.id} repo={repo} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RepoCard
// ---------------------------------------------------------------------------

function RepoCard({ repo }: { repo: Repository }) {
  const riskScore = repo.riskScore ?? 0;
  const riskLabel =
    riskScore >= 71 ? 'High risk' : riskScore >= 41 ? 'Medium risk' : 'Low risk';
  const riskLabelColour =
    riskScore >= 71
      ? 'text-red-600'
      : riskScore >= 41
        ? 'text-amber-600'
        : 'text-green-600';

  return (
    <Link
      href={`/repos/${repo.id}`}
      className="group flex flex-col gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      {/* Top row: name + risk ring */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold group-hover:text-primary">{repo.name}</p>
          <p className="truncate text-xs text-muted-foreground">{repo.fullName}</p>
        </div>
        <RiskScoreRing score={riskScore} size={52} className="shrink-0" />
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Globe className="h-3 w-3" />
          {repo.provider}
        </span>
        <span className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          {repo.defaultBranch}
        </span>
        {repo.language && <span>{repo.language}</span>}
        <span className="flex items-center gap-1">
          {repo.isPrivate
            ? <Lock className="h-3 w-3" />
            : <Unlock className="h-3 w-3" />}
          {repo.isPrivate ? 'Private' : 'Public'}
        </span>
      </div>

      {/* Footer row: risk label + last scanned */}
      <div className="flex items-center justify-between border-t pt-3">
        <span className={`text-xs font-medium ${riskLabelColour}`}>
          {riskScore > 0 ? riskLabel : 'Not yet scanned'}
        </span>
        <span className="text-xs text-muted-foreground">
          {repo.lastScannedAt
            ? `Scanned ${timeAgo(new Date(repo.lastScannedAt).toISOString())}`
            : 'Never scanned'}
        </span>
      </div>
    </Link>
  );
}
