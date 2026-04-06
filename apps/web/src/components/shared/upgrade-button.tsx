'use client';

/**
 * UpgradeButton — initiates the Stripe Checkout flow to upgrade from FREE to TEAM.
 *
 * Calls POST /api/v1/billing/checkout, then redirects the browser to the
 * returned Stripe-hosted Checkout URL. Shows a loading state during the fetch.
 *
 * Client-only — auth token is fetched from Clerk's useAuth() hook.
 */

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Loader2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export function UpgradeButton() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade() {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication error. Please refresh and try again.');
        return;
      }

      const res = await fetch(`${API_BASE}/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const body = await res.json() as { success: boolean; data?: { url: string | null }; error?: string };

      if (!body.success || !body.data?.url) {
        setError(body.error ?? 'Could not start checkout. Please try again.');
        return;
      }

      // Redirect to Stripe-hosted Checkout page
      window.location.href = body.data.url;
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleUpgrade}
        disabled={loading}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-colors'
        )}
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Redirecting to checkout…
          </>
        ) : (
          <>
            <Zap className="h-3.5 w-3.5 fill-current" />
            Upgrade to Team - $29/mo
          </>
        )}
      </button>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
