/**
 * Settings page — org-level config: account info, VCS connections, Slack, plan.
 *
 * Server component: fetches org data and GitLab VCS status in parallel.
 * Interactive sub-forms (Slack, GitLab token) are client components.
 */

import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getOrgSettings, getGitLabVcsStatus } from '@/lib/api';
import { SlackWebhookForm } from '@/components/shared/slack-webhook-form';
import { GitLabTokenForm } from '@/components/shared/gitlab-token-form';
import { UpgradeButton } from '@/components/shared/upgrade-button';
import {
  ShieldCheck,
  Building2,
  CreditCard,
  Bell,
  GitBranch,
} from 'lucide-react';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const { userId, getToken } = auth();
  if (!userId) redirect('/sign-in');

  const [user, token] = await Promise.all([currentUser(), getToken()]);
  if (!token) redirect('/sign-in');

  // Fetch org data and GitLab status in parallel
  const [orgResponse, gitlabResponse] = await Promise.all([
    getOrgSettings(token),
    getGitLabVcsStatus(token),
  ]);

  const org = orgResponse.data;
  const gitlab = gitlabResponse.data;

  // UI conservatively allows editing — the API enforces RBAC server-side
  const canEdit = true;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and organization settings.
        </p>
      </div>

      {/* Account */}
      <SettingsSection icon={<ShieldCheck className="h-4 w-4" />} title="Account">
        <div className="grid gap-2 text-sm">
          <Row
            label="Name"
            value={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || '—'}
          />
          <Row label="Email" value={user?.emailAddresses[0]?.emailAddress ?? '—'} />
          <Row label="User ID" value={userId} mono />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          To update your name, email, or password, visit the{' '}
          <a
            href="https://accounts.clerk.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Clerk account portal
          </a>
          .
        </p>
      </SettingsSection>

      {/* Organization */}
      {org && (
        <SettingsSection icon={<Building2 className="h-4 w-4" />} title="Organization">
          <div className="grid gap-2 text-sm">
            <Row label="Name" value={org.name} />
            <Row label="Slug" value={org.slug} mono />
            <Row label="Plan" value={org.plan} />
            <Row label="Seats" value={String(org.seats)} />
          </div>
        </SettingsSection>
      )}

      {/* VCS Connections */}
      <SettingsSection icon={<GitBranch className="h-4 w-4" />} title="VCS Connections">
        {/* GitHub */}
        <div className="mb-5">
          <h3 className="mb-1 text-sm font-medium">GitHub</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Connected via GitHub App installation. Manages webhooks and check runs automatically.
          </p>
          <div className="text-sm">
            {org?.githubInstallationId ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                ✓ Connected · Installation {org.githubInstallationId}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Not connected</span>
            )}
          </div>
        </div>

        <hr className="my-4 border-border" />

        {/* GitLab */}
        <div>
          <h3 className="mb-1 text-sm font-medium">GitLab</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Authenticate with a Personal Access Token or Group Access Token to enable GitLab
            merge request scanning and push event analysis.
          </p>
          <GitLabTokenForm
            connected={gitlab?.connected ?? false}
            configuredAt={gitlab?.configuredAt ?? null}
            tokenExpiresAt={gitlab?.tokenExpiresAt ?? null}
            canEdit={canEdit}
          />
        </div>
      </SettingsSection>

      {/* Notifications — Slack */}
      <SettingsSection icon={<Bell className="h-4 w-4" />} title="Notifications">
        <div className="mb-4">
          <h3 className="mb-1 text-sm font-medium">Slack</h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Receive a Slack message when each scan completes or fails. Notifications include the
            risk score, finding counts, and a direct link to the scan report.
          </p>
          <SlackWebhookForm
            currentWebhookUrl={org?.slackWebhookUrl ?? null}
            canEdit={canEdit}
          />
        </div>

        <hr className="my-4 border-border" />

        <div>
          <h3 className="mb-1 text-sm font-medium">Email digest</h3>
          <p className="text-xs text-muted-foreground">
            Weekly email summaries are coming soon.
          </p>
        </div>
      </SettingsSection>

      {/* Plan */}
      <SettingsSection icon={<CreditCard className="h-4 w-4" />} title="Plan & Billing">
        <div className="grid gap-2 text-sm">
          <Row label="Current plan" value={org?.plan ?? '—'} />
          <Row label="Seat limit" value={org ? String(org.seats) : '—'} />
        </div>
        {org?.plan === 'FREE' && (
          <div className="mt-4">
            <p className="mb-3 text-xs text-muted-foreground">
              Upgrade to Team for unlimited scans, priority support, and up to 25 seats.
            </p>
            <UpgradeButton />
          </div>
        )}
        {org?.plan !== 'FREE' && (
          <p className="mt-3 text-xs text-muted-foreground">
            To manage your subscription, contact{' '}
            <a href="mailto:hello@thecodesheriff.com" className="underline hover:text-foreground">
              hello@thecodesheriff.com
            </a>
            .
          </p>
        )}
      </SettingsSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SettingsSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center gap-2 font-semibold">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value}</span>
    </div>
  );
}
