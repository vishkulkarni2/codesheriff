'use client';

/**
 * SetupChecklist — appears on the dashboard when the org has no scans yet.
 * Shows the three integration steps with their status and CTAs.
 */

import { CheckCircle2, Circle, ExternalLink, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface SetupChecklistProps {
  hasRepos: boolean;
  hasScans: boolean;
  hasGitLab: boolean;
  hasSlack: boolean;
}

export function SetupChecklist({ hasRepos, hasScans, hasGitLab, hasSlack }: SetupChecklistProps) {
  const allDone = hasRepos && hasScans;
  if (allDone) return null;

  const items = [
    {
      done: hasRepos,
      label: 'Connect a GitHub repository',
      description: 'Install the GitHub App and grant read access to at least one repo.',
      action: (
        <a
          href={`https://github.com/apps/${process.env['NEXT_PUBLIC_GITHUB_APP_SLUG'] ?? 'codesheriff'}/installations/new`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Install on GitHub
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ),
    },
    {
      done: hasScans,
      label: 'Run your first scan',
      description: 'Pick a repo and trigger a scan — results appear in under a minute.',
      action: hasRepos ? (
        <Link
          href="/repos"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Go to Repositories
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null,
    },
    {
      done: hasGitLab,
      label: 'Connect GitLab (optional)',
      description: 'Add a GitLab Personal Access Token to scan GitLab repositories.',
      action: (
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-primary hover:underline"
        >
          Settings
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ),
      optional: true,
    },
    {
      done: hasSlack,
      label: 'Set up Slack notifications (optional)',
      description: 'Get notified in Slack after every scan.',
      action: (
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-primary hover:underline"
        >
          Settings
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ),
      optional: true,
    },
  ];

  const required = items.filter((i) => !i.optional);
  const completedRequired = required.filter((i) => i.done).length;

  return (
    <section className="rounded-2xl border bg-card p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Get started</h2>
          <p className="text-sm text-muted-foreground">
            {completedRequired} of {required.length} required steps completed
          </p>
        </div>
        {/* Progress bar */}
        <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
          <div
            className="h-2 rounded-full bg-primary transition-all"
            style={{ width: `${(completedRequired / required.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col divide-y">
        {items.map((item) => (
          <div key={item.label} className={cn('flex items-start gap-4 py-4 first:pt-0 last:pb-0')}>
            <div className="mt-0.5 shrink-0">
              {item.done ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <Circle className={cn('h-5 w-5', item.optional ? 'text-muted-foreground/30' : 'text-muted-foreground/50')} />
              )}
            </div>
            <div className="flex flex-1 flex-col gap-0.5">
              <p className={cn('text-sm font-medium', item.done && 'text-muted-foreground line-through')}>
                {item.label}
                {item.optional && (
                  <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                    optional
                  </span>
                )}
              </p>
              {!item.done && (
                <p className="text-xs text-muted-foreground">{item.description}</p>
              )}
            </div>
            {!item.done && item.action && (
              <div className="shrink-0 pt-0.5">{item.action}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
