'use client';

/**
 * RepoSyncPoller — shown after GitHub App installation redirect.
 * Polls the API until repos appear, then refreshes the page.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { listRepos } from '@/lib/api';
import { Loader2, GitBranch } from 'lucide-react';

export function RepoSyncPoller() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const poll = async () => {
      const token = await getToken();
      if (!token) return;
      const { data } = await listRepos(token);
      if (data && data.length > 0) {
        // Repos synced — refresh the page to show them (strip query params)
        router.replace('/repos?setup_action=install&synced=true');
        router.refresh();
      }
    };

    const id = setInterval(poll, 2000);
    // Also poll immediately
    void poll();

    return () => clearInterval(id);
  }, [getToken, router]);

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border bg-card py-20 text-center">
      <div className="relative">
        <GitBranch className="h-10 w-10 text-primary/30" />
        <Loader2 className="absolute -right-1 -top-1 h-5 w-5 animate-spin text-primary" />
      </div>
      <div>
        <p className="font-medium">Syncing your repositories...</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The GitHub App was installed successfully. We're syncing your repos now.
          {elapsed > 5 && ' This usually takes a few seconds.'}
        </p>
      </div>
      {elapsed > 15 && (
        <p className="text-xs text-muted-foreground">
          Taking longer than expected? Try{' '}
          <button onClick={() => router.refresh()} className="underline hover:text-foreground">
            refreshing
          </button>{' '}
          the page.
        </p>
      )}
    </div>
  );
}
