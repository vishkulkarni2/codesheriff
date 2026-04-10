'use client';

/**
 * RepoScanList -- client component that renders scans for a repository.
 *
 * Accepts server-fetched initial data, then polls the scans API while any
 * scan is still QUEUED or RUNNING. Stops polling once all visible scans
 * reach a terminal state.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { listScans } from '@/lib/api';
import { ScanStatus } from '@codesheriff/shared';
import type { RecentScanEntry } from '@codesheriff/shared';
import { RiskScoreRing } from '@/components/shared/risk-score-ring';
import { timeAgo } from '@/lib/utils';
import Link from 'next/link';
import { GitBranch, Loader2 } from 'lucide-react';

const TERMINAL_STATUSES = new Set<string>([
  ScanStatus.COMPLETE,
  ScanStatus.FAILED,
  ScanStatus.CANCELLED,
]);

const POLL_INTERVAL_MS = 3000;

interface RepoScanListProps {
  repositoryId: string;
  initialScans: RecentScanEntry[];
  initialTotal: number;
}

function ScanStatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    COMPLETE: 'bg-green-100 text-green-700',
    RUNNING: 'bg-blue-100 text-blue-700 animate-pulse',
    QUEUED: 'bg-gray-100 text-gray-600 animate-pulse',
    FAILED: 'bg-red-100 text-red-700',
    CANCELLED: 'bg-gray-100 text-gray-500',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[status] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {(status === 'RUNNING' || status === 'QUEUED') && (
        <Loader2 className="h-3 w-3 animate-spin" />
      )}
      {status}
    </span>
  );
}

export function RepoScanList({
  repositoryId,
  initialScans,
  initialTotal,
}: RepoScanListProps) {
  const { getToken } = useAuth();
  const [scans, setScans] = useState<RecentScanEntry[]>(initialScans);
  const [total, setTotal] = useState(initialTotal);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasActiveScans = scans.some((s) => !TERMINAL_STATUSES.has(s.status));

  const fetchScans = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const res = await listScans(token, { repositoryId, limit: 20 });
    if (res.success && res.data) {
      setScans(res.data.scans);
      setTotal(res.data.total);
    }
  }, [getToken, repositoryId]);

  // Update scans when initialScans prop changes (e.g. after router.refresh)
  useEffect(() => {
    setScans(initialScans);
    setTotal(initialTotal);
  }, [initialScans, initialTotal]);

  // Poll while there are active (non-terminal) scans
  useEffect(() => {
    if (!hasActiveScans) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Do an immediate fetch in case server data is stale
    fetchScans();

    intervalRef.current = setInterval(fetchScans, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hasActiveScans, fetchScans]);

  if (scans.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border bg-card/50 py-14 text-center">
        <GitBranch className="h-8 w-8 text-muted-foreground/40" />
        <div>
          <p className="font-medium text-muted-foreground">No scans yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the <span className="font-medium">Run scan</span> button above
            to trigger a manual scan, or push a commit to run one automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            {['Status', 'Risk score', 'Findings', 'Triggered', 'When'].map(
              (h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {scans.map((scan) => (
            <tr
              key={scan.id}
              className="border-b last:border-0 hover:bg-muted/30"
            >
              <td className="px-4 py-3">
                <ScanStatusPill status={scan.status} />
              </td>
              <td className="px-4 py-3">
                <RiskScoreRing score={scan.riskScore ?? 0} size={36} />
              </td>
              <td className="px-4 py-3 tabular-nums">{scan.findingsCount}</td>
              <td className="px-4 py-3 text-muted-foreground">Manual</td>
              <td className="px-4 py-3 text-muted-foreground">
                <Link
                  href={`/scans/${scan.id}`}
                  className="hover:text-foreground hover:underline"
                >
                  {timeAgo(scan.createdAt)}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
