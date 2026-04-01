'use client';

/**
 * DownloadSarifButton — client component that fetches the SARIF export for a
 * completed scan and triggers a browser file download.
 *
 * SARIF (Static Analysis Results Interchange Format) 2.1.0 is the format
 * used by GitHub's code scanning upload API. The generated file can be piped
 * directly to:
 *   POST /repos/{owner}/{repo}/code-scanning/sarifs
 *
 * The API endpoint requires a Bearer token so a plain <a href> won't work —
 * we fetch the response in JS, read it as a Blob, create an object URL, and
 * programmatically click a hidden anchor to trigger the download.
 */

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { getScanSarif } from '@/lib/api';
import { Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DownloadSarifButtonProps {
  scanId: string;
  /** Visual size variant matching TriggerScanButton */
  variant?: 'default' | 'sm';
  /** Only complete scans have meaningful SARIF output */
  disabled?: boolean;
}

export function DownloadSarifButton({
  scanId,
  variant = 'default',
  disabled = false,
}: DownloadSarifButtonProps) {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    if (loading || disabled) return;
    setError(null);
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication error. Please refresh and try again.');
        return;
      }

      const res = await getScanSarif(token, scanId);

      if (!res.ok) {
        setError('Failed to export SARIF. Please try again.');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // Derive filename from Content-Disposition header if present, else fallback
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `codesheriff-scan-${scanId}.sarif`;

      // Programmatic download: create ephemeral anchor, click, revoke
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      setError('Download failed. Check your network and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleDownload}
        disabled={loading || disabled}
        title={disabled ? 'SARIF export is only available for completed scans' : 'Download SARIF 2.1.0'}
        className={cn(
          'inline-flex items-center gap-2 rounded-md font-medium transition-colors',
          'border bg-background hover:bg-accent',
          loading || disabled ? 'cursor-not-allowed opacity-50' : '',
          variant === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
        )}
      >
        {loading ? (
          <Loader2 className={cn('animate-spin', variant === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        ) : (
          <Download className={cn(variant === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        )}
        {loading ? 'Exporting…' : 'Download SARIF'}
      </button>

      {/* Inline error — appears below the button, fades away after ~4 s */}
      {error && (
        <p className="absolute left-0 top-full mt-1 whitespace-nowrap text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
