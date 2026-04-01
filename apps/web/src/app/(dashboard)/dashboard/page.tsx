/**
 * Dashboard home — overview of risk scores, recent scans, findings breakdown.
 * Server component — fetches data with the Clerk session token on the server.
 */

import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getDashboard, getOrgSettings, getGitLabVcsStatus } from '@/lib/api';
import { RiskScoreRing } from '@/components/shared/risk-score-ring';
import { SeverityBadge } from '@/components/shared/severity-badge';
import { SetupChecklist } from '@/components/shared/setup-checklist';
import { RiskTrendChart } from '@/components/shared/risk-trend-chart';
import { Severity } from '@codesheriff/shared';
import { GitBranch, AlertTriangle, CheckCircle2, Clock, TrendingUp } from 'lucide-react';
import { timeAgo } from '@/lib/utils';
import Link from 'next/link';

export const metadata = { title: 'Dashboard' };

// Map category breakdown colours
const CATEGORY_COLOURS: Record<string, string> = {
  SECURITY: 'bg-red-500',
  HALLUCINATION: 'bg-purple-500',
  AUTH: 'bg-orange-500',
  LOGIC: 'bg-yellow-500',
  SECRET: 'bg-pink-500',
  QUALITY: 'bg-blue-500',
};

export default async function DashboardPage() {
  const { getToken, userId } = auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  if (!token) redirect('/sign-in');

  const user = await currentUser();

  const [{ data, error }, { data: orgData }, { data: gitlabStatus }] = await Promise.all([
    getDashboard(token),
    getOrgSettings(token),
    getGitLabVcsStatus(token),
  ]);

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
        Failed to load dashboard. Please refresh.
      </div>
    );
  }

  const hasRepos  = data.topRiskyRepos.length > 0;
  const hasScans  = data.recentScans.length > 0;
  const hasGitLab = gitlabStatus?.connected ?? false;
  const hasSlack  = !!(orgData?.slackWebhookUrl);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">
          Welcome back{user?.firstName ? `, ${user.firstName}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          Organization overview
        </p>
      </div>

      {/* First-run setup checklist */}
      <SetupChecklist
        hasRepos={hasRepos}
        hasScans={hasScans}
        hasGitLab={hasGitLab}
        hasSlack={hasSlack}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Org risk score"
          value={<RiskScoreRing score={data.orgRiskScore} size={64} />}
        />
        <StatCard
          label="Critical findings"
          value={<span className="text-3xl font-bold">{data.criticalFindings}</span>}
          icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="Scans this month"
          value={<span className="text-3xl font-bold">{data.scansThisMonth}</span>}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          label="Repositories"
          value={<span className="text-3xl font-bold">{data.topRiskyRepos.length}</span>}
          icon={<GitBranch className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      {/* Top risky repos */}
      {data.topRiskyRepos.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Riskiest repositories</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.topRiskyRepos.map((repo) => (
              <Link
                key={repo.id}
                href={`/repos/${repo.id}`}
                className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-accent/50"
              >
                <RiskScoreRing score={repo.riskScore} size={48} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{repo.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {repo.criticalCount} critical · {repo.highCount} high
                  </p>
                  {repo.lastScannedAt && (
                    <p className="text-xs text-muted-foreground">
                      {timeAgo(repo.lastScannedAt)}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recent scans */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent scans</h2>
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                {['Repository', 'Status', 'Risk', 'Findings', 'When'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.recentScans.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No scans yet. Push a commit or trigger a scan manually.
                  </td>
                </tr>
              ) : (
                data.recentScans.map((scan) => (
                  <tr key={scan.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/scans/${scan.id}`} className="hover:underline">
                        {scan.repositoryName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <ScanStatusPill status={scan.status} />
                    </td>
                    <td className="px-4 py-3">
                      <RiskScoreRing score={scan.riskScore ?? 0} size={36} />
                    </td>
                    <td className="px-4 py-3">{scan.findingsCount}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {timeAgo(scan.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Risk trend chart */}
      {data.findingsTrend.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Findings trend</h2>
          <RiskTrendChart data={data.findingsTrend} />
        </section>
      )}

      {/* Category breakdown */}
      {data.findingsByCategory.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Findings by category</h2>
          <div className="flex flex-col gap-2">
            {data.findingsByCategory.map(({ category, count, percentage }) => (
              <div key={category} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm text-muted-foreground">{category}</span>
                <div className="flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-2 rounded-full ${CATEGORY_COLOURS[category] ?? 'bg-gray-500'}`}
                    style={{ width: `${Math.max(2, percentage)}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm font-medium">{count}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon}
      </div>
      <div className="flex items-center">{value}</div>
    </div>
  );
}

function ScanStatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    COMPLETED: 'bg-green-100 text-green-700',
    RUNNING: 'bg-blue-100 text-blue-700',
    QUEUED: 'bg-gray-100 text-gray-600',
    FAILED: 'bg-red-100 text-red-700',
    CANCELLED: 'bg-gray-100 text-gray-500',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status === 'COMPLETED' && <CheckCircle2 className="h-3 w-3" />}
      {status}
    </span>
  );
}
