'use client';

/**
 * GitHubSyncButton — allows users to manually sync repos from their
 * GitHub App installation. Useful when the installation webhook fails.
 */

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { syncGitHubRepos } from '@/lib/api';
import { Loader2, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

interface GitHubSyncButtonProps {
  hasInstallation: boolean;
}

export function GitHubSyncButton({ hasInstallation }: GitHubSyncButtonProps) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setResult(null);

    try {
      const token = await getToken();
      if (!token) {
        setResult({ success: false, message: 'Not authenticated. Please sign in again.' });
        return;
      }

      const response = await syncGitHubRepos(token);

      if (response.success && response.data) {
        setResult({
          success: true,
          message: `Synced ${response.data.count} ${response.data.count === 1 ? 'repository' : 'repositories'} from GitHub.`,
        });
        // Refresh page data
        router.refresh();
      } else {
        setResult({
          success: false,
          message: response.error ?? 'Sync failed. Please try again.',
        });
      }
    } catch {
      setResult({ success: false, message: 'Network error. Please try again.' });
    } finally {
      setSyncing(false);
    }
  };

  if (!hasInstallation) {
    return (
      <a
        href="https://github.com/apps/codesheriff-review/installations/new"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Install GitHub App
      </a>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleSync}
        disabled={syncing}
        className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
      >
        {syncing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {syncing ? 'Syncing...' : 'Sync Repos'}
      </button>
      {result && (
        <div
          className={`flex items-center gap-1.5 text-xs ${
            result.success ? 'text-green-600' : 'text-red-600'
          }`}
        >
          {result.success ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <AlertCircle className="h-3 w-3" />
          )}
          {result.message}
        </div>
      )}
    </div>
  );
}
