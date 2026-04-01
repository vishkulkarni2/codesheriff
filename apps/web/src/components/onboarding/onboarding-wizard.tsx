'use client';

/**
 * OnboardingWizard — guided first-run setup.
 *
 * Steps:
 *   1. Install GitHub App  → polls until a repo appears
 *   2. Pick repo + trigger first scan
 *   3. Watch scan run live → navigate to scan detail on completion
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { listRepos, triggerScan, getScan } from '@/lib/api';
import type { Repository } from '@codesheriff/shared';
import { ScanStatus } from '@codesheriff/shared';
import {
  CheckCircle2,
  Circle,
  Loader2,
  GitBranch,
  Rocket,
  ExternalLink,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// GitHub App slug — override with NEXT_PUBLIC_GITHUB_APP_SLUG env var
const GITHUB_APP_SLUG =
  process.env['NEXT_PUBLIC_GITHUB_APP_SLUG'] ?? 'codesheriff';

type Step = 'install' | 'pick' | 'scan' | 'done';

interface ScanState {
  scanId: string;
  status: string;
  findingsCount: number;
}

export function OnboardingWizard() {
  const { getToken } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>('install');
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [commitSha, setCommitSha] = useState('');
  const [scanState, setScanState] = useState<ScanState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // ─── Step 1: poll for repos after GitHub App install ─────────────────────
  const pollForRepos = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const { data } = await listRepos(token);
    if (data && data.length > 0) {
      setRepos(data);
      setStep('pick');
    }
  }, [getToken]);

  useEffect(() => {
    if (step !== 'install') return;
    const id = setInterval(pollForRepos, 3000);
    return () => clearInterval(id);
  }, [step, pollForRepos]);

  // ─── Step 3: poll scan status ─────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'scan' || !scanState) return;
    if (
      scanState.status === ScanStatus.COMPLETE ||
      scanState.status === ScanStatus.FAILED ||
      scanState.status === ScanStatus.CANCELLED
    ) {
      if (scanState.status === ScanStatus.COMPLETE) {
        setStep('done');
        setTimeout(() => router.push(`/scans/${scanState.scanId}`), 1800);
      }
      return;
    }

    const id = setInterval(async () => {
      const token = await getToken();
      if (!token) return;
      const { data } = await getScan(token, scanState.scanId);
      if (!data) return;
      setScanState({
        scanId: scanState.scanId,
        status: data.status,
        findingsCount: data.findings?.length ?? 0,
      });
    }, 2500);

    return () => clearInterval(id);
  }, [step, scanState, getToken, router]);

  // ─── Trigger scan ──────────────────────────────────────────────────────────
  async function handleTriggerScan() {
    if (!selectedRepo || !commitSha.trim()) return;
    setBusy(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const { data, error: apiErr } = await triggerScan(token, {
        repositoryId: selectedRepo.id,
        commitSha: commitSha.trim(),
        branch: selectedRepo.defaultBranch,
      });
      if (apiErr || !data) throw new Error(apiErr ?? 'Failed to start scan');
      setScanState({ scanId: data.scanId, status: data.status, findingsCount: 0 });
      setStep('scan');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  const steps: { key: Step; label: string }[] = [
    { key: 'install', label: 'Install GitHub App' },
    { key: 'pick', label: 'Select a repo' },
    { key: 'scan', label: 'Run first scan' },
  ];

  const stepIndex = (s: Step) => ['install', 'pick', 'scan', 'done'].indexOf(s);
  const currentIndex = stepIndex(step);

  return (
    <div className="flex flex-col gap-8">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold">Welcome to CodeSheriff</h1>
        <p className="mt-1 text-muted-foreground">
          Let's connect your first repository and run a security scan in under 2 minutes.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {steps.map((s, i) => (
          <div key={s.key} className="flex flex-1 items-center">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
                  stepIndex(step) > i
                    ? 'border-primary bg-primary text-primary-foreground'
                    : stepIndex(step) === i
                      ? 'border-primary text-primary'
                      : 'border-muted-foreground/30 text-muted-foreground/40'
                )}
              >
                {stepIndex(step) > i ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  'hidden text-sm font-medium sm:block',
                  stepIndex(step) >= i ? 'text-foreground' : 'text-muted-foreground/40'
                )}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  'mx-3 h-px flex-1 transition-colors',
                  stepIndex(step) > i ? 'bg-primary' : 'bg-border'
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step panels */}
      <div className="rounded-2xl border bg-card p-8 shadow-sm">
        {/* ── Step 1: Install ── */}
        {step === 'install' && (
          <div className="flex flex-col gap-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <GitBranch className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Install the GitHub App</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Grant CodeSheriff read access to the repositories you want to monitor.
                  Only <code className="rounded bg-muted px-1 text-xs">read</code> permissions
                  are needed — we never write to your code.
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <p className="font-medium">What happens next</p>
              <ol className="mt-2 flex flex-col gap-1 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  Click the button below — GitHub will open
                </li>
                <li className="flex items-start gap-2">
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  Choose which repos to grant access to
                </li>
                <li className="flex items-start gap-2">
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  Return here — this page will advance automatically
                </li>
              </ol>
            </div>

            <div className="flex items-center gap-4">
              <a
                href={`https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Install on GitHub
                <ExternalLink className="h-4 w-4" />
              </a>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for installation…
              </span>
            </div>
          </div>
        )}

        {/* ── Step 2: Pick repo ── */}
        {step === 'pick' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-semibold">Select a repository to scan</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose a repo and enter the commit SHA you want analysed.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {repos.map((repo) => (
                <button
                  key={repo.id}
                  onClick={() => setSelectedRepo(repo)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-4 text-left transition-colors',
                    selectedRepo?.id === repo.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-accent/40'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors',
                      selectedRepo?.id === repo.id ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                    )}
                  >
                    {selectedRepo?.id === repo.id && (
                      <div className="h-2 w-2 rounded-full bg-white" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{repo.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{repo.fullName}</p>
                  </div>
                  <span className="ml-auto shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {repo.defaultBranch}
                  </span>
                </button>
              ))}
            </div>

            {selectedRepo && (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  Commit SHA
                  <span className="ml-1 font-normal text-muted-foreground">(paste from GitHub)</span>
                </label>
                <input
                  type="text"
                  value={commitSha}
                  onChange={(e) => setCommitSha(e.target.value)}
                  placeholder="e.g. a1b2c3d4e5f6..."
                  className="rounded-lg border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            {error && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
            )}

            <button
              onClick={handleTriggerScan}
              disabled={!selectedRepo || !commitSha.trim() || busy}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity',
                'bg-primary text-primary-foreground',
                (!selectedRepo || !commitSha.trim() || busy) ? 'cursor-not-allowed opacity-50' : 'hover:opacity-90'
              )}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {busy ? 'Starting…' : 'Start first scan'}
            </button>
          </div>
        )}

        {/* ── Step 3: Watching scan ── */}
        {(step === 'scan' || step === 'done') && scanState && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-semibold">
                {step === 'done' ? 'Scan complete!' : 'Scan in progress…'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {step === 'done'
                  ? `Found ${scanState.findingsCount} finding${scanState.findingsCount !== 1 ? 's' : ''}. Taking you to the results…`
                  : 'CodeSheriff is fetching your files and running the analyzer.'}
              </p>
            </div>

            <ScanStepTracker status={scanState.status} findingsCount={scanState.findingsCount} />
          </div>
        )}
      </div>

      {/* Skip link */}
      {step !== 'done' && (
        <p className="text-center text-sm text-muted-foreground">
          Already set up?{' '}
          <button
            onClick={() => router.push('/dashboard')}
            className="underline hover:text-foreground"
          >
            Go to dashboard
          </button>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScanStepTracker — shows live analyzer pipeline steps
// ---------------------------------------------------------------------------

const STEPS = [
  { key: 'queued',    label: 'Job queued',          runningStatus: ['PENDING'] },
  { key: 'fetching',  label: 'Fetching files',       runningStatus: ['RUNNING'] },
  { key: 'analyzing', label: 'Running analyzers',    runningStatus: ['RUNNING'] },
  { key: 'complete',  label: 'Complete',             runningStatus: [] },
];

function ScanStepTracker({ status, findingsCount }: { status: string; findingsCount: number }) {
  const isComplete = status === ScanStatus.COMPLETE;
  const isFailed   = status === ScanStatus.FAILED;

  // Which step index is "active"
  const activeStep =
    isFailed   ? -1 :
    isComplete ? 3 :
    status === 'RUNNING' ? 2 : 0;

  return (
    <div className="flex flex-col gap-3">
      {STEPS.map((s, i) => {
        const done    = isComplete ? true : i < activeStep;
        const active  = !isComplete && i === activeStep;
        const pending = !done && !active;

        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center">
              {done ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : active ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/30" />
              )}
            </div>
            <span
              className={cn(
                'text-sm',
                done ? 'font-medium text-foreground' :
                active ? 'font-medium text-primary' :
                'text-muted-foreground/50'
              )}
            >
              {s.label}
              {done && i === 3 && findingsCount > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  {findingsCount} findings
                </span>
              )}
            </span>
          </div>
        );
      })}

      {isFailed && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          Scan failed — check the scan detail page for more information.
        </p>
      )}
    </div>
  );
}
