'use client';

/**
 * SlackWebhookForm — lets org owners and admins configure the Slack
 * incoming webhook URL used for post-scan notifications.
 *
 * Behaviour:
 *   - Pre-fills with the current masked URL (last 12 chars shown)
 *   - Validates the Slack webhook URL format client-side before submitting
 *   - "Remove" button clears the webhook (sends { slackWebhookUrl: null })
 *   - Shows success / error feedback inline
 */

import { useState, useTransition } from 'react';
import { useAuth } from '@clerk/nextjs';
import { updateOrgSettings } from '@/lib/api';
import { CheckCircle2, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Mirrors the server-side regex in orgs.ts */
const SLACK_WEBHOOK_RE = /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+$/;

interface SlackWebhookFormProps {
  /** Current stored webhook URL. Null if not configured. */
  currentWebhookUrl: string | null;
  /** Only OWNER and ADMIN can edit — MEMBER sees a read-only view. */
  canEdit: boolean;
}

export function SlackWebhookForm({ currentWebhookUrl, canEdit }: SlackWebhookFormProps) {
  const { getToken } = useAuth();
  const [isPending, startTransition] = useTransition();

  const [webhookUrl, setWebhookUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const isConfigured = currentWebhookUrl !== null;

  // Mask the URL: show only scheme + last 12 chars for security
  const maskedUrl = currentWebhookUrl
    ? `https://hooks.slack.com/services/…${currentWebhookUrl.slice(-12)}`
    : null;

  const isValidUrl = SLACK_WEBHOOK_RE.test(webhookUrl.trim());

  function handleSave() {
    if (!isValidUrl) return;
    setStatus('idle');
    setErrorMsg('');

    startTransition(async () => {
      const token = await getToken();
      if (!token) { setStatus('error'); setErrorMsg('Authentication error. Please refresh.'); return; }

      const res = await updateOrgSettings(token, { slackWebhookUrl: webhookUrl.trim() });
      if (res.success) {
        setStatus('success');
        setWebhookUrl(''); // clear field — new URL is now persisted
      } else {
        setStatus('error');
        setErrorMsg(res.error ?? 'Failed to update. Please try again.');
      }
    });
  }

  function handleRemove() {
    setStatus('idle');
    setErrorMsg('');

    startTransition(async () => {
      const token = await getToken();
      if (!token) { setStatus('error'); setErrorMsg('Authentication error. Please refresh.'); return; }

      const res = await updateOrgSettings(token, { slackWebhookUrl: null });
      if (res.success) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMsg(res.error ?? 'Failed to remove. Please try again.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Current state badge */}
      <div className="flex items-center gap-2 text-sm">
        <span className={cn(
          'inline-flex h-2 w-2 rounded-full',
          isConfigured ? 'bg-green-500' : 'bg-gray-300'
        )} />
        {isConfigured ? (
          <span>
            Configured: <span className="font-mono text-xs text-muted-foreground">{maskedUrl}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Not configured</span>
        )}
      </div>

      {canEdit && (
        <>
          {/* URL input */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="slack-webhook" className="text-sm font-medium">
              {isConfigured ? 'Update webhook URL' : 'Add webhook URL'}
            </label>
            <div className="flex gap-2">
              <input
                id="slack-webhook"
                type="url"
                value={webhookUrl}
                onChange={(e) => {
                  setWebhookUrl(e.target.value);
                  setStatus('idle');
                }}
                placeholder="https://hooks.slack.com/services/T…/B…/…"
                className={cn(
                  'flex-1 rounded-md border bg-background px-3 py-2 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                  webhookUrl && !isValidUrl ? 'border-red-400' : ''
                )}
                disabled={isPending}
                aria-describedby="slack-webhook-hint"
              />
              <button
                onClick={handleSave}
                disabled={!isValidUrl || isPending}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
                  'bg-primary text-primary-foreground',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  'transition-colors hover:bg-primary/90'
                )}
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save
              </button>
            </div>

            {/* Validation hint */}
            {webhookUrl && !isValidUrl && (
              <p className="text-xs text-red-600">
                Must be a valid Slack incoming webhook URL (https://hooks.slack.com/services/…)
              </p>
            )}

            <p id="slack-webhook-hint" className="text-xs text-muted-foreground">
              Create one in your Slack workspace under{' '}
              <a
                href="https://api.slack.com/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 underline hover:text-foreground"
              >
                api.slack.com/apps
                <ExternalLink className="h-3 w-3" />
              </a>
              {' '}→ Incoming Webhooks.
            </p>
          </div>

          {/* Remove button (only when configured) */}
          {isConfigured && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleRemove}
                disabled={isPending}
                className={cn(
                  'text-sm text-red-600 underline-offset-2 hover:underline',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {isPending ? 'Removing…' : 'Remove Slack integration'}
              </button>
            </div>
          )}
        </>
      )}

      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Only org owners and admins can configure Slack notifications.
        </p>
      )}

      {/* Feedback */}
      {status === 'success' && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          Settings saved successfully.
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />
          {errorMsg}
        </div>
      )}
    </div>
  );
}
