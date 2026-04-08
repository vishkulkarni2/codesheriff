/**
 * Scan detail page — shows scan metadata + paginated findings + SARIF export.
 *
 * The API returns a flat ScanWithFindings object (all Scan scalar fields spread
 * directly onto data, plus data.findings and data.repository). Pagination meta
 * lives at the top-level ApiResponse.meta field.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { getScan } from '@/lib/api';
import { SeverityBadge } from '@/components/shared/severity-badge';
import { RiskScoreRing } from '@/components/shared/risk-score-ring';
import { DownloadSarifButton } from '@/components/shared/download-sarif-button';
import { Severity, FindingCategory, ScanStatus } from '@codesheriff/shared';
import { timeAgo } from '@/lib/utils';
import { FindingsTable } from '@/components/shared/findings-table';
import { ArrowLeft, Clock, GitCommit, GitBranch } from 'lucide-react';
import Link from 'next/link';
import type { ScanWithFindings } from '@codesheriff/shared';
import { ScanProgressBanner } from '@/components/shared/scan-progress-banner';

interface ScanPageProps {
  params: { id: string };
  searchParams: { page?: string; severity?: string; category?: string };
}

export const metadata = { title: 'Scan details' };

// Force this page to be dynamically rendered on every request. Without this,
// router.refresh() from the live progress banner can return a cached HTML
// payload and the page never visibly updates without a hard reload.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ScanDetailPage({ params, searchParams }: ScanPageProps) {
  const { getToken, userId } = auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  if (!token) redirect('/sign-in');

  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10));
  const severity = searchParams.severity;
  const category = searchParams.category;

  const response = await getScan(token, params.id, {
    page,
    limit: 25,
    ...(severity !== undefined ? { severity } : {}),
    ...(category !== undefined ? { category } : {}),
  });

  if (response.error) return notFound();

  // data IS the flat ScanWithFindings object — scan fields are spread directly
  // on it, not nested under a "scan" key. Repository is at data.repository.
  const data = response.data as ScanWithFindings;
  if (!data) redirect('/dashboard');

  const meta = response.meta ?? { page: 1, limit: 25, total: 0, totalPages: 1 };
  const isComplete = data.status === ScanStatus.COMPLETE;

  const isLive = data.status === ScanStatus.QUEUED || data.status === ScanStatus.RUNNING;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Live progress banner — shown while scan is in flight */}
      {isLive && <ScanProgressBanner initialData={data} />}

      {/* Breadcrumb */}
      <div>
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <h1 className="text-2xl font-bold">{data.repository.name}</h1>
        <p className="text-sm text-muted-foreground">{data.repository.fullName}</p>
      </div>

      {/* Scan meta card */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4">
        <RiskScoreRing score={data.riskScore ?? 0} size={64} />

        {/* Commit / branch info */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm">
            <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-xs">{data.commitSha.slice(0, 8)}</span>
            <span className="text-muted-foreground">·</span>
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{data.branch}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {timeAgo(new Date(data.createdAt).toISOString())}
            {data.completedAt &&
              ` · completed ${timeAgo(new Date(data.completedAt).toISOString())}`}
          </div>
        </div>

        {/* Status + SARIF download */}
        <div className="ml-auto flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              data.status === ScanStatus.COMPLETE
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : data.status === ScanStatus.FAILED
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : data.status === ScanStatus.RUNNING
                    ? 'animate-pulse bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
            }`}
          >
            {data.status}
          </span>

          {/* SARIF export — only meaningful for completed scans */}
          <DownloadSarifButton scanId={data.id} disabled={!isComplete} />
        </div>
      </div>

      {/* Summary chips */}
      {isComplete && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: 'Critical', count: data.criticalCount, colour: 'text-red-600' },
            { label: 'High',     count: data.highCount,     colour: 'text-orange-600' },
            { label: 'Medium',   count: data.mediumCount,   colour: 'text-amber-600' },
            { label: 'Low',      count: data.lowCount,      colour: 'text-yellow-600' },
          ].map(({ label, count, colour }) => (
            <div
              key={label}
              className="flex flex-col items-center rounded-lg border bg-card px-4 py-2"
            >
              <span className={`text-lg font-bold ${colour}`}>{count}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Findings table */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Findings{' '}
            <span className="text-sm font-normal text-muted-foreground">
              ({meta.total} total)
            </span>
          </h2>

          {/* Severity filter pills */}
          <div className="flex flex-wrap items-center gap-2">
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const).map((sev) => (
              <Link
                key={sev}
                href={`/scans/${data.id}?severity=${sev}`}
                className={`text-xs ${severity === sev ? 'ring-2 ring-ring ring-offset-1 rounded' : ''}`}
              >
                <SeverityBadge severity={sev as Severity} />
              </Link>
            ))}
            <Link
              href={`/scans/${data.id}`}
              className="text-xs text-muted-foreground hover:underline"
            >
              All
            </Link>
          </div>
        </div>

        <FindingsTable findings={data.findings as any} scanId={data.id} />

        {/* Pagination */}
        {(meta.totalPages ?? 1) > 1 && (
          <div className="mt-4 flex justify-center gap-2">
            {Array.from({ length: meta.totalPages ?? 1 }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={`/scans/${data.id}?page=${p}${severity ? `&severity=${severity}` : ''}${category ? `&category=${category}` : ''}`}
                className={`rounded px-3 py-1 text-sm ${
                  p === meta.page
                    ? 'bg-primary text-primary-foreground'
                    : 'border hover:bg-accent'
                }`}
              >
                {p}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
