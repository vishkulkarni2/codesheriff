'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export function CancelSubscriptionButton() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [canceled, setCanceled] = useState(false);

  async function handleCancel() {
    if (!confirming) {
      setConfirming(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication error. Please refresh and try again.');
        return;
      }

      const res = await fetch(`${API_BASE}/billing/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const body = await res.json() as { success: boolean; error?: string };

      if (!body.success) {
        setError(body.error ?? 'Could not cancel subscription. Please try again.');
        return;
      }

      setCanceled(true);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (canceled) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Subscription canceled. You retain Pro access until the end of your billing period.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleCancel}
        disabled={loading}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
          'border border-destructive/30 text-destructive hover:bg-destructive/10',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-colors'
        )}
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Canceling…
          </>
        ) : confirming ? (
          <>
            <XCircle className="h-3.5 w-3.5" />
            Confirm cancellation
          </>
        ) : (
          <>
            <XCircle className="h-3.5 w-3.5" />
            Cancel subscription
          </>
        )}
      </button>
      {confirming && !loading && (
        <p className="text-center text-xs text-muted-foreground">
          Click again to confirm. You will keep Pro access until your billing period ends.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
