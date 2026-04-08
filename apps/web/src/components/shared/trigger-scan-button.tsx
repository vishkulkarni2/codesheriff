'use client';

/**
 * TriggerScanButton — opens a modal dialog to trigger a manual scan.
 *
 * The form collects a branch (defaulted to main) and optional PR context.
 * The commit SHA is resolved server-side from the branch HEAD — users never
 * need to know or enter a SHA. On success it transitions to a "Scan queued"
 * state with a direct link to the new scan's detail page.
 *
 * Client-only — auth token is fetched from Clerk's useAuth() hook.
 */

import { useState, useTransition, useRef, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { triggerScan, listRepoBranches } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Play,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  GitBranch,
  ExternalLink,
} from 'lucide-react';

interface TriggerScanButtonProps {
  repositoryId: string;
  defaultBranch?: string;
  /** Visual size variant */
  variant?: 'default' | 'sm';
}

type DialogState = 'idle' | 'open' | 'submitting' | 'success' | 'error';

export function TriggerScanButton({
  repositoryId,
  defaultBranch = 'main',
  variant = 'default',
}: TriggerScanButtonProps) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>('idle');
  const [, startTransition] = useTransition();
  const [newScanId, setNewScanId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form fields
  const [branch, setBranch] = useState(defaultBranch);
  const [prNumber, setPrNumber] = useState('');
  const [prTitle, setPrTitle] = useState('');

  // Branch list (fetched from GitHub via the API on dialog open)
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchInputMode, setBranchInputMode] = useState<'select' | 'custom'>('select');

  // Validation — branch is the only required field
  const branchValid = branch.trim().length > 0;
  const canSubmit = branchValid;

  // Focus the first input when dialog opens
  const branchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dialogState === 'open') {
      setTimeout(() => branchRef.current?.focus(), 50);
    }
  }, [dialogState]);

  // Close on Escape
  useEffect(() => {
    if (dialogState === 'idle') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogState]);

  function handleOpen() {
    setBranch(defaultBranch);
    setPrNumber('');
    setPrTitle('');
    setErrorMsg(null);
    setNewScanId(null);
    setBranches(null);
    setBranchInputMode('select');
    setDialogState('open');

    // Fetch the branch list in the background — non-blocking, falls back
    // gracefully to a free-text input if the request fails or the API
    // returns a partial result.
    (async () => {
      setBranchesLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await listRepoBranches(token, repositoryId);
        if (res.success && res.data) {
          setBranches(res.data.branches);
          // If the API only returned the default branch (degraded), let the
          // user type a custom branch instead of forcing the dropdown.
          if (res.data.partial) setBranchInputMode('custom');
        } else {
          setBranchInputMode('custom');
        }
      } catch {
        setBranchInputMode('custom');
      } finally {
        setBranchesLoading(false);
      }
    })();
  }

  function handleClose() {
    setDialogState('idle');
  }

  function handleSubmit() {
    if (!canSubmit) return;

    startTransition(async () => {
      setDialogState('submitting');
      setErrorMsg(null);

      const token = await getToken();
      if (!token) {
        setErrorMsg('Authentication error. Please refresh and try again.');
        setDialogState('error');
        return;
      }

      const parsedPrNumber = prNumber ? parseInt(prNumber, 10) : undefined;
      const parsedPrTitle = prTitle.trim() || undefined;
      const res = await triggerScan(token, {
        repositoryId,
        branch: branch.trim(),
        ...(parsedPrNumber !== undefined ? { prNumber: parsedPrNumber } : {}),
        ...(parsedPrTitle !== undefined ? { prTitle: parsedPrTitle } : {}),
      });

      if (!res.success || !res.data) {
        setErrorMsg(res.error ?? 'Failed to queue scan. Please try again.');
        setDialogState('error');
        return;
      }

      setNewScanId(res.data.scanId);
      setDialogState('success');
      // Refresh server data on the current page (scan list may update)
      router.refresh();
    });
  }

  const isOpen = dialogState !== 'idle';

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={handleOpen}
        className={cn(
          'inline-flex items-center gap-2 rounded-md font-medium transition-colors',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          variant === 'sm'
            ? 'px-3 py-1.5 text-xs'
            : 'px-4 py-2 text-sm'
        )}
      >
        <Play className={cn('fill-current', variant === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        Run scan
      </button>

      {/* Backdrop + dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={handleClose}
            aria-hidden="true"
          />

          {/* Dialog panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="trigger-scan-title"
            className="relative z-10 w-full max-w-md rounded-xl border bg-card shadow-lg"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 id="trigger-scan-title" className="font-semibold">
                Trigger manual scan
              </h2>
              <button
                onClick={handleClose}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4">
              {/* ── Success state ── */}
              {dialogState === 'success' && newScanId && (
                <div className="flex flex-col items-center gap-4 py-4 text-center">
                  <CheckCircle2 className="h-12 w-12 text-green-500" />
                  <div>
                    <p className="font-semibold">Scan queued successfully</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Analysis is running in the background. Results appear when
                      the scan completes.
                    </p>
                  </div>
                  <a
                    href={`/scans/${newScanId}`}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View scan
                  </a>
                </div>
              )}

              {/* ── Form state ── */}
              {(dialogState === 'open' || dialogState === 'submitting' || dialogState === 'error') && (
                <div className="flex flex-col gap-4">
                  {/* Error banner */}
                  {dialogState === 'error' && errorMsg && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {errorMsg}
                    </div>
                  )}

                  {/* Branch */}
                  <div>
                    <label
                      htmlFor="ts-branch"
                      className="mb-1.5 flex items-center justify-between gap-1.5 text-xs font-medium text-muted-foreground"
                    >
                      <span className="flex items-center gap-1.5">
                        <GitBranch className="h-3.5 w-3.5" />
                        Branch <span className="text-red-500">*</span>
                      </span>
                      {branches && branches.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setBranchInputMode((m) => (m === 'select' ? 'custom' : 'select'))
                          }
                          className="text-xs font-normal text-primary hover:underline"
                          disabled={dialogState === 'submitting'}
                        >
                          {branchInputMode === 'select' ? 'Type a branch name' : 'Pick from list'}
                        </button>
                      )}
                    </label>

                    {branchInputMode === 'select' && branches && branches.length > 0 ? (
                      <select
                        id="ts-branch"
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        disabled={dialogState === 'submitting'}
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2 text-sm',
                          'focus:outline-none focus:ring-1 focus:ring-ring',
                          'disabled:cursor-not-allowed disabled:opacity-50'
                        )}
                      >
                        {/* Make sure the active branch is in the list even if
                            it was somehow not returned by the API */}
                        {(branches.includes(branch) ? branches : [branch, ...branches]).map(
                          (b) => (
                            <option key={b} value={b}>
                              {b}
                              {b === defaultBranch ? ' (default)' : ''}
                            </option>
                          )
                        )}
                      </select>
                    ) : (
                      <input
                        id="ts-branch"
                        ref={branchRef}
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        placeholder={defaultBranch || 'main'}
                        disabled={dialogState === 'submitting'}
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2 text-sm',
                          'focus:outline-none focus:ring-1 focus:ring-ring',
                          'disabled:cursor-not-allowed disabled:opacity-50'
                        )}
                      />
                    )}

                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {branchesLoading
                        ? 'Loading branches…'
                        : branches && branches.length > 0
                          ? `${branches.length} branch${branches.length === 1 ? '' : 'es'} available. The latest commit on this branch will be scanned.`
                          : 'The latest commit on this branch will be scanned.'}
                    </p>
                  </div>

                  {/* Optional PR context — collapsible section */}
                  <details className="group">
                    <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
                      Optional: PR context
                    </summary>
                    <div className="mt-3 flex flex-col gap-3">
                      <div>
                        <label
                          htmlFor="ts-pr-number"
                          className="mb-1.5 block text-xs font-medium text-muted-foreground"
                        >
                          PR number
                        </label>
                        <input
                          id="ts-pr-number"
                          type="number"
                          min={1}
                          value={prNumber}
                          onChange={(e) => setPrNumber(e.target.value)}
                          placeholder="e.g. 42"
                          disabled={dialogState === 'submitting'}
                          className={cn(
                            'w-full rounded-md border bg-background px-3 py-2 text-sm',
                            'focus:outline-none focus:ring-1 focus:ring-ring',
                            'disabled:cursor-not-allowed disabled:opacity-50'
                          )}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="ts-pr-title"
                          className="mb-1.5 block text-xs font-medium text-muted-foreground"
                        >
                          PR title
                        </label>
                        <input
                          id="ts-pr-title"
                          value={prTitle}
                          onChange={(e) => setPrTitle(e.target.value)}
                          placeholder="e.g. Add user authentication"
                          disabled={dialogState === 'submitting'}
                          className={cn(
                            'w-full rounded-md border bg-background px-3 py-2 text-sm',
                            'focus:outline-none focus:ring-1 focus:ring-ring',
                            'disabled:cursor-not-allowed disabled:opacity-50'
                          )}
                        />
                      </div>
                    </div>
                  </details>
                </div>
              )}
            </div>

            {/* Footer */}
            {dialogState !== 'success' && (
              <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
                <button
                  onClick={handleClose}
                  disabled={dialogState === 'submitting'}
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit || dialogState === 'submitting'}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
                    'bg-primary text-primary-foreground hover:bg-primary/90',
                    'disabled:cursor-not-allowed disabled:opacity-50'
                  )}
                >
                  {dialogState === 'submitting' ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Queueing…
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 fill-current" />
                      Scan
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
