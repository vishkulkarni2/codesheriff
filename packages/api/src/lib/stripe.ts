/**
 * Stripe SDK singleton.
 *
 * Initialized lazily on first use so the API can boot even if
 * STRIPE_SECRET_KEY is not set (billing routes will fail gracefully).
 *
 * SECURITY: Key is read from environment — never hardcoded.
 */

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;

  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY environment variable is not set');
  }

  _stripe = new Stripe(key, {
    apiVersion: '2024-06-20',
  });

  return _stripe;
}
