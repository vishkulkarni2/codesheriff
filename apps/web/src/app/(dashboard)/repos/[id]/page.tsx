/**
 * Repository detail page — shows repo info, risk history, and recent scans.
 * Includes a TriggerScanButton in the header for manual scan dispatch.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getRepo, listScans } from '@/lib/api';
import { RiskScoreRing } from '@/components/shared/risk-score-ring';
import { TriggerScanButton } from '@/components/shared/trigger-scan-button';
import { RepoScanList } from '@/components/shared/repo-scan-list';
import { timeAgo } from '@/lib/utils';
import Link from 'next/link';
import { ArrowLeft, GitBranch, Globe, Lock, Unlock, Clock } from 'lucide-react';

interface RepoPageProps {
  params: { id: string };
}

export const metadata = { title: 'Repository' };

export default async function RepoPage({ params }: RepoPageProps) {
  const { getToken, userId } = auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  if (!token) redirect('/sign-in');

  const [repoRes, scansRes] = await Promise.all([
    getRepo(token, params.id),
    listScans(token, { repositoryId: params.id, limit: 20 }),
  ]);

  if (!repoRes.success || !repoRes.data) return notFound();

  const repo = repoRes.data;
  const recentScans = scansRes.data?.scans ?? [];
  const totalScans = scansRes.data?.total ?? 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <Link
        href="/repos"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Repositories
      </Link>

      {/* Repo header card */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <RiskScoreRing score={repo.riskScore ?? 0} size={64} className="shrink-0" />
          <div>
            <h1 className="text-xl font-bold">{repo.name}</h1>
            <p className="text-sm text-muted-foreground">{repo.fullName}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
              {repo.lastScannedAt && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Last scanned {timeAgo(new Date(repo.lastScannedAt).toISOString())}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Scan trigger — client component */}
        <TriggerScanButton
          repositoryId={repo.id}
          defaultBranch={repo.defaultBranch}
        />
      </div>

      {/* Recent scans */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Scans
            {totalScans > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({totalScans} total)
              </span>
            )}
          </h2>
        </div>

        <RepoScanList
          repositoryId={repo.id}
          initialScans={recentScans}
          initialTotal={totalScans}
        />
      </section>
    </div>
  );
}

