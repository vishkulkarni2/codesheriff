'use client';

/**
 * useScanPolling — polls GET /scans/:id every `intervalMs` while the scan
 * is in a non-terminal state (PENDING or RUNNING).
 *
 * Stops automatically once the scan reaches COMPLETED, FAILED, or CANCELLED.
 * Returns the latest scan data and a loading flag.
 */

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { getScan } from '@/lib/api';
import type { ScanWithFindings } from '@codesheriff/shared';
import { ScanStatus } from '@codesheriff/shared';

const TERMINAL_STATUSES = new Set([
  ScanStatus.COMPLETE,
  ScanStatus.FAILED,
  ScanStatus.CANCELLED,
]);

interface UseScanPollingOptions {
  scanId: string;
  initialData: ScanWithFindings;
  intervalMs?: number;
}

interface UseScanPollingResult {
  scan: ScanWithFindings;
  isPolling: boolean;
}

export function useScanPolling({
  scanId,
  initialData,
  intervalMs = 2500,
}: UseScanPollingOptions): UseScanPollingResult {
  const { getToken } = useAuth();
  const [scan, setScan] = useState<ScanWithFindings>(initialData);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isTerminal = TERMINAL_STATUSES.has(scan.status as ScanStatus);

  useEffect(() => {
    // Don't poll if already in a terminal state
    if (isTerminal) return;

    const poll = async () => {
      const token = await getToken();
      if (!token) return;
      const { data } = await getScan(token, scanId);
      if (data) {
        setScan(data);
        // Stop polling once terminal
        if (TERMINAL_STATUSES.has(data.status as ScanStatus)) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      }
    };

    intervalRef.current = setInterval(poll, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [scanId, isTerminal, getToken, intervalMs]);

  return { scan, isPolling: !isTerminal };
}
