'use client';

/**
 * ScanProgressBanner — shown at the top of the scan detail page when
 * a scan is still PENDING or RUNNING.
 *
 * Receives initialData from the server component, then takes over polling
 * client-side until the scan reaches a terminal state. On completion it
 * triggers a full page refresh so the server-rendered findings table
 * populates without a full navigation.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useScanPolling } from '@/hooks/use-scan-polling';
import type { ScanWithFindings } from '@codesheriff/shared';
import { ScanStatus } from '@codesheriff/shared';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScanProgressBannerProps {
  initialData: ScanWithFindings;
}

export function ScanProgressBanner({ initialData }: ScanProgressBannerProps) {
  const router = useRouter();
  const { scan, isPolling } = useScanPolling({
    scanId: initialData.id,
    initialData,
  });

  // Refresh the server component tree once the scan completes
  useEffect(() => {
    if (
      scan.status === ScanStatus.COMPLETE ||
      scan.status === ScanStatus.FAILED
    ) {
      router.refresh();
    }
  }, [scan.status, router]);

  // Don't render banner for terminal-on-first-load scans
  if (
    !isPolling &&
    scan.status !== ScanStatus.COMPLETE &&
    scan.status !== ScanStatus.FAILED
  ) {
    return null;
  }

  const isFailed    = scan.status === ScanStatus.FAILED;
  const isCompleted = scan.status === ScanStatus.COMPLETE;

  return (
    <div
      className={cn(
        'mb-4 rounded-xl border p-5',
        isFailed    ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10' :
        isCompleted ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/10' :
                      'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/10'
      )}
    >
      <p className={cn(
        'mb-3 text-sm font-semibold',
        isFailed ? 'text-red-700' : isCompleted ? 'text-green-700' : 'text-blue-700'
      )}>
        {isFailed    ? 'Scan failed'       :
         isCompleted ? 'Scan complete'     :
                       'Scan in progress…'}
      </p>

      <PipelineSteps status={scan.status} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline step definitions
// ---------------------------------------------------------------------------

const PIPELINE_STEPS = [
  {
    label: 'Job queued',
    doneWhen: (s: string) => s !== 'PENDING',
    activeWhen: (s: string) => s === 'PENDING',
  },
  {
    label: 'Fetching repository files',
    doneWhen: (s: string) => s === ScanStatus.COMPLETE || s === ScanStatus.FAILED,
    activeWhen: (s: string) => s === ScanStatus.RUNNING,
  },
  {
    label: 'Running pattern + secret detectors',
    doneWhen: (s: string) => s === ScanStatus.COMPLETE || s === ScanStatus.FAILED,
    activeWhen: (s: string) => s === ScanStatus.RUNNING,
  },
  {
    label: 'AI code review',
    doneWhen: (s: string) => s === ScanStatus.COMPLETE || s === ScanStatus.FAILED,
    activeWhen: (s: string) => s === ScanStatus.RUNNING,
  },
  {
    label: 'Results ready',
    doneWhen: (s: string) => s === ScanStatus.COMPLETE,
    activeWhen: () => false,
  },
];

function PipelineSteps({ status }: { status: string }) {
  const isCompleted = status === ScanStatus.COMPLETE;
  const isFailed    = status === ScanStatus.FAILED;

  // For RUNNING we animate steps 1-3 sequentially
  const runningSubstep = useRunningSubstep(status);

  return (
    <div className="flex flex-col gap-2">
      {PIPELINE_STEPS.map((s, i) => {
        let done: boolean;
        let active: boolean;

        if (isCompleted) {
          done = true; active = false;
        } else if (isFailed) {
          done = i < 1; active = false;
        } else if (status === ScanStatus.RUNNING) {
          done   = i === 0 || (i >= 1 && i < runningSubstep);
          active = i >= 1 && i === runningSubstep;
        } else {
          // PENDING
          done   = false;
          active = i === 0;
        }

        return (
          <div key={s.label} className="flex items-center gap-2.5">
            {isFailed && !done ? (
              <XCircle className="h-4 w-4 text-red-400" />
            ) : done ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : active ? (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground/30" />
            )}
            <span
              className={cn(
                'text-sm',
                done    ? 'text-foreground' :
                active  ? 'font-medium text-blue-700 dark:text-blue-400' :
                          'text-muted-foreground/50'
              )}
            >
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Cycles through sub-steps 1-3 every 3s to give visual momentum during RUNNING state. */
function useRunningSubstep(status: string) {
  const [substep, setSubstep] = useState(1);

  useEffect(() => {
    if (status !== ScanStatus.RUNNING) return;
    const id = setInterval(() => {
      setSubstep((s) => (s >= 3 ? 3 : s + 1));
    }, 3000);
    return () => clearInterval(id);
  }, [status]);

  return substep;
}

// Need to import useState here since this is a client file
import { useState } from 'react';
