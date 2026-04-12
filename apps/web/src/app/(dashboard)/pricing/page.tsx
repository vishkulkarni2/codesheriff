/**
 * Pricing page — matches the marketing site at thecodesheriff.com/pricing.
 *
 * Tiers: Free / Pro ($29/dev/mo) / Scale ($25/dev/mo, min 20) / Enterprise
 *
 * The marketing site is the source of truth for pricing and feature gating.
 * This page must stay in sync with codesheriff-marketing/app/pricing/page.tsx
 * on Mac Mini at ~/.openclaw/workspace/codesheriff-marketing/.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { UpgradeButton } from '@/components/shared/upgrade-button';
import { Check, X, ArrowRight } from 'lucide-react';
import { getBillingStatus } from '@/lib/api';

export const metadata = { title: 'Pricing — CodeSheriff' };

interface PlanFeature {
  label: string;
  free: boolean | string;
  pro: boolean | string;
  scale: boolean | string;
}

const FEATURES: PlanFeature[] = [
  { label: 'Repositories', free: '1 repo', pro: 'All repos', scale: 'All repos' },
  { label: 'Semgrep + regex static analysis', free: true, pro: true, scale: true },
  { label: 'Full AI pipeline (hallucination, auth, logic detection)', free: false, pro: true, scale: true },
  { label: 'Auto-fix suggestions', free: false, pro: true, scale: true },
  { label: 'GitHub PR comments', free: true, pro: true, scale: true },
  { label: 'Slack integration', free: false, pro: true, scale: true },
  { label: 'SARIF export', free: false, pro: true, scale: true },
  { label: 'CLI access', free: false, pro: true, scale: true },
  { label: 'Custom rules', free: false, pro: false, scale: true },
  { label: 'Policy enforcement', free: false, pro: false, scale: true },
  { label: 'SSO / SAML', free: false, pro: false, scale: true },
  { label: 'Email support', free: false, pro: true, scale: true },
  { label: 'Priority support', free: false, pro: false, scale: true },
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
      // Fall back to FREE
    }
  }

  const isPro = currentPlan === 'TEAM' || currentPlan === 'PRO';
  const isScale = currentPlan === 'ENTERPRISE' || currentPlan === 'SCALE';

  return (
    <div className="flex flex-col items-center gap-8 p-6 md:p-10">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Plans and Pricing</h1>
        <p className="mt-2 text-muted-foreground">
          Free for individuals. Pro for teams shipping AI-generated code.
        </p>
      </div>

      <div className="grid w-full max-w-5xl gap-6 md:grid-cols-3">
        {/* FREE tier */}
        <div className="flex flex-col rounded-xl border bg-card p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold">Free</h2>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">$0</span>
              <span className="text-sm text-muted-foreground">forever</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Static analysis for one repo. Get started in 60 seconds.
            </p>
          </div>

          <div className="mb-6 flex-1">
            <ul className="flex flex-col gap-3 text-sm">
              {FEATURES.map((f) => (
                <FeatureRow key={f.label} label={f.label} value={f.free} />
              ))}
            </ul>
          </div>

          {!isPro && !isScale && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-2 text-center text-sm font-medium text-primary">
              Current plan
            </div>
          )}
        </div>

        {/* PRO tier */}
        <div className="relative flex flex-col rounded-xl border-2 border-primary bg-card p-6">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
            Most popular
          </div>

          <div className="mb-6">
            <h2 className="text-lg font-semibold">Pro</h2>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">$29</span>
              <span className="text-sm text-muted-foreground">per dev / month</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Full AI pipeline. The only scanner that catches hallucinated APIs, auth bugs, and logic issues.
            </p>
          </div>

          <div className="mb-6 flex-1">
            <ul className="flex flex-col gap-3 text-sm">
              {FEATURES.map((f) => (
                <FeatureRow key={f.label} label={f.label} value={f.pro} />
              ))}
            </ul>
          </div>

          {isPro ? (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-2 text-center text-sm font-medium text-primary">
              Current plan
            </div>
          ) : (
            <UpgradeButton />
          )}
        </div>

        {/* SCALE tier */}
        <div className="flex flex-col rounded-xl border bg-card p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold">Scale</h2>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">$25</span>
              <span className="text-sm text-muted-foreground">per dev / month</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Minimum 20 developers. Everything in Pro plus custom rules, policy enforcement, and SSO. Starts at $500/mo.
            </p>
          </div>

          <div className="mb-6 flex-1">
            <ul className="flex flex-col gap-3 text-sm">
              {FEATURES.map((f) => (
                <FeatureRow key={f.label} label={f.label} value={f.scale} />
              ))}
            </ul>
          </div>

          <a
            href="mailto:sales@thecodesheriff.com"
            className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Talk to sales
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <p className="max-w-xl text-center text-xs text-muted-foreground">
        Need Enterprise features? SAML, audit logs, compliance exports, dedicated CSM, and uptime SLA.{' '}
        <a
          href="mailto:sales@thecodesheriff.com"
          className="underline hover:text-foreground"
        >
          Contact sales
        </a>
        . Free plan always available. Cancel Pro anytime.
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
        {typeof value === 'string' ? `${label}: ${value}` : label}
      </span>
    </li>
  );
}
