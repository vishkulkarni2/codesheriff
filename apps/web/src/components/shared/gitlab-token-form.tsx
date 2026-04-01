'use client';

/**
 * GitLabTokenForm — save or rotate a GitLab Personal/Group Access Token.
 *
 * The token is sent to PUT /api/v1/orgs/current/vcs/gitlab where it is
 * encrypted (AES-256-GCM) before being stored. The raw token never comes
 * back to the UI after saving — we only show connection status.
 *
 * Required GitLab token scopes: read_api, read_repository
 */

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CheckCircle2, AlertCircle, Link2Off, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GitLabTokenFormProps {
  /** Whether a token is already saved for this org */
  connected: boolean;
  /** ISO-8601 date the token was last configured, or null */
  configuredAt: string | null;
  /** ISO-8601 expiry date from the token record, or null */
  tokenExpiresAt: string | null;
  canEdit: boolean;
}

export function GitLabTokenForm({
  connected: initialConnected,
  configuredAt,
  tokenExpiresAt,
  canEdit,
}: GitLabTokenFormProps) {
  const { getToken } = useAuth();

  const [connected, setConnected] = useState(initialConnected);
  const [token, setToken] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'disconnected'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim() || saving) return;

    setSaving(true);
    setStatus('idle');
    setErrorMsg('');

    try {
      const authToken = await getToken();
      const res = await fetch('/api/v1/orgs/current/vcs/gitlab', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          token: token.trim(),
          ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        setErrorMsg((body as { error?: string }).error ?? 'Failed to save token');
        setStatus('error');
        return;
      }

      setConnected(true);
      setToken('');
      setExpiresAt('');
      setStatus('saved');
    } catch {
      setErrorMsg('Network error — check your connection and try again');
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    setStatus('idle');

    try {
      const authToken = await getToken();
      const res = await fetch('/api/v1/orgs/current/vcs/gitlab', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (res.ok || res.status === 204) {
        setConnected(false);
        setStatus('disconnected');
      } else {
        setErrorMsg('Failed to disconnect GitLab');
        setStatus('error');
      }
    } catch {
      setErrorMsg('Network error — could not disconnect');
      setStatus('error');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Connection status banner */}
      {connected ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            GitLab connected
            {configuredAt && (
              <span className="ml-1 text-green-600 dark:text-green-500">
                · configured {new Date(configuredAt).toLocaleDateString()}
              </span>
            )}
            {tokenExpiresAt && (
              <span className="ml-1 text-green-600 dark:text-green-500">
                · expires {new Date(tokenExpiresAt).toLocaleDateString()}
              </span>
            )}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-muted bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Link2Off className="h-4 w-4 shrink-0" />
          GitLab not connected
        </div>
      )}

      {/* Success/error feedback */}
      {status === 'saved' && (
        <p className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          Token saved — GitLab scans are now enabled.
        </p>
      )}
      {status === 'disconnected' && (
        <p className="text-sm text-muted-foreground">GitLab disconnected.</p>
      )}
      {status === 'error' && (
        <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4" />
          {errorMsg}
        </p>
      )}

      {canEdit && (
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {connected ? 'Rotate token' : 'Personal or Group Access Token'}
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
              autoComplete="off"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2 font-mono text-sm',
                'placeholder:text-muted-foreground/50',
                'focus:outline-none focus:ring-2 focus:ring-ring'
              )}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Required scopes:{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">read_api</code>{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">read_repository</code>
              {' '}·{' '}
              <a
                href="https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-xs underline hover:text-foreground"
              >
                GitLab docs
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Token expiry date{' '}
              <span className="font-normal text-muted-foreground/70">(optional)</span>
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={cn(
                'rounded-md border bg-background px-3 py-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring'
              )}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || !token.trim()}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
                'bg-primary text-primary-foreground transition-opacity',
                saving || !token.trim() ? 'cursor-not-allowed opacity-50' : 'hover:opacity-90'
              )}
            >
              {saving ? 'Saving…' : connected ? 'Rotate token' : 'Connect GitLab'}
            </button>

            {connected && (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-sm text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )}
          </div>
        </form>
      )}

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          Only org owners and admins can manage VCS connections.
        </p>
      )}
    </div>
  );
}
