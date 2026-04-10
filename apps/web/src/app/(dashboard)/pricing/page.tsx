/**
 * Pricing page — FREE vs TEAM tier comparison.
 *
 * Server component that renders the plan comparison.
 * The UpgradeButton is a client component (already exists) that
 * calls POST /api/v1/billing/checkout and redirects to Stripe.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { UpgradeButton } from '@/components/shared/upgrade-button';
import { Check, X } from 'lucide-react';
import { getBillingStatus } from '@/lib/api';

export const metadata = { title: 'Pricing — CodeSheriff' };

interface PlanFeature {
  label: string;
  free: boolean | string;
  team: boolean | string;
}

const FEATURES: PlanFeature[] = [
  { label: 'Full security scanning (6 languages)', free: true, team: true },
  { label: 'Semgrep + AI-powered detection', free: true, team: true },
  { label: 'Dashboard with findings view', free: true, team: true },
  { label: 'Manual + webhook-triggered scans', free: true, team: true },
  { label: 'Repositories', free: 'Up to 3', team: 'Unlimited' },
  { label: 'PR inline review comments', free: false, team: true },
  { label: 'AI-generated fix suggestions', free: false, team: true },
  { label: 'Custom org rules', free: false, team: true },
  { label: 'Slack notifications', free: false, team: true },
  { label: 'SARIF export to GitHub Code Scanning', free: false, team: true },
  { label: 'Priority support', free: false, team: true },
];

export default async function PricingPage() {
  const { userId, getToken } = auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  let currentPlan = 'FREE';
  if (token) {
    try {
      const billing = await getBillingStatus(token);
      if (billing.data?.plan) currentPlan = billing.data.plan;
    } catch {
      // Fall back to showing FREE — the button will fail gracefully
    }
  }

  const isTeam = currentPlan === 'TEAM' || currentPlan === 'ENTERPRISE';

  return (
    <div className="flex flex-col items-center gap-8 p-6 md:p-10">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Plans & Pricing</h1>
        <p className="mt-2 text-muted-foreground">
          Every plan gets the full AI-powered security scanner. Upgrade for team
          collaboration features.
        </p>
      </div>

      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-2">
        {/* FREE tier */}
        <div className="flex flex-col rounded-xl border bg-card p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold">Free</h2>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">$0</span>
              <span className="text-sm text-muted-foreground">/mo</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Full scanning for individuals and small projects.
            </p>
          </div>

          <div className="mb-6 flex-1">
            <ul className="flex flex-col gap-3 text-sm">
              {FEATURES.map((f) => (
                <FeatureRow key={f.label} label={f.label} value={f.free} />
              ))}
            </ul>
          </div>

          {!isTeam && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-2 text-center text-sm font-medium text-primary">
              Current plan
            </div>
          )}
        </div>

        {/* TEAM tier */}
        <div className="relative flex flex-col rounded-xl border-2 border-primary bg-card p-6">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
            Recommended
          </div>

          <div className="mb-6">
            <h2 className="text-lg font-semibold">Team</h2>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">$49</span>
              <span className="text-sm text-muted-foreground">/mo per org</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Everything in Free, plus PR reviews, fix suggestions, and more.
            </p>
          </div>

          <div className="mb-6 flex-1">
            <ul className="flex flex-col gap-3 text-sm">
              {FEATURES.map((f) => (
                <FeatureRow key={f.label} label={f.label} value={f.team} />
              ))}
            </ul>
          </div>

          {isTeam ? (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-2 text-center text-sm font-medium text-primary">
              Current plan
            </div>
          ) : (
            <UpgradeButton />
          )}
        </div>
      </div>

      <p className="max-w-xl text-center text-xs text-muted-foreground">
        All plans include unlimited scans. Need Enterprise features like SSO,
        RBAC, or dedicated support?{' '}
        <a
          href="mailto:hello@thecodesheriff.com"
          className="underline hover:text-foreground"
        >
          Contact us
        </a>
        .
      </p>
    </div>
  );
}

function FeatureRow({ label, value }: { label: string; value: boolean | string }) {
  return (
    <li className="flex items-start gap-2">
      {value === true ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
      ) : value === false ? (
        <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
      ) : (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
      )}
      <span className={value === false ? 'text-muted-foreground/60' : ''}>
        {typeof value === 'string' ? `${label} (${value})` : label}
      </span>
    </li>
  );
}
