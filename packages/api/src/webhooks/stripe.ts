/**
 * Stripe Webhook Handler
 *
 * Handles Stripe billing events to keep the org's plan and subscription
 * status in sync with Stripe.
 *
 * Events handled:
 *   - checkout.session.completed      → set plan=TEAM, store customer/subscription IDs
 *   - customer.subscription.updated   → sync subscription status (active/past_due/etc)
 *   - customer.subscription.deleted   → downgrade to FREE, clear subscription fields
 *
 * SECURITY:
 *   - stripe-signature header verified using stripe.webhooks.constructEvent
 *   - Raw body required for signature verification — JSON parser overridden in this scope
 *   - Webhook secret read from STRIPE_WEBHOOK_SECRET env var — never hardcoded
 *
 * Setup:
 *   1. Add STRIPE_WEBHOOK_SECRET to .env (from Stripe Dashboard → Webhooks → endpoint secret)
 *   2. Configure Stripe webhook endpoint: POST /webhooks/stripe
 *   3. Subscribe to: checkout.session.completed, customer.subscription.updated,
 *      customer.subscription.deleted
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Stripe from 'stripe';
import { prisma } from '@codesheriff/db';
import { Plan } from '@codesheriff/shared';
import { getStripe } from '../lib/stripe.js';

export async function stripeWebhookRoutes(app: FastifyInstance): Promise<void> {
  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];

  if (!webhookSecret) {
    app.log.warn(
      'STRIPE_WEBHOOK_SECRET not set — Stripe webhooks disabled. Plan updates will not be synced.'
    );
    return;
  }

  // Override the JSON content type parser within this plugin scope so that
  // req.body is a raw Buffer — required for Stripe signature verification.
  // This only affects routes registered in this plugin (i.e., POST /stripe).
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => {
      done(null, body);
    }
  );

  app.post(
    '/stripe',
    { schema: { hide: true } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const sig = req.headers['stripe-signature'];

      if (!sig || typeof sig !== 'string') {
        req.log.warn('Stripe webhook missing stripe-signature header');
        return reply.status(400).send({ error: 'Missing stripe-signature header' });
      }

      const stripe = getStripe();
      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
      } catch (err) {
        req.log.warn({ err }, 'Stripe webhook signature verification failed');
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      req.log.info({ type: event.type }, 'Stripe webhook received');

      try {
        switch (event.type) {
          case 'checkout.session.completed':
            await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, req.log);
            break;

          case 'customer.subscription.updated':
            await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, req.log);
            break;

          case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, req.log);
            break;

          default:
            req.log.info({ type: event.type }, 'Stripe webhook: unhandled event type — ignoring');
        }
      } catch (err) {
        req.log.error({ err, eventType: event.type }, 'Stripe webhook handler failed');
        // Return 500 so Stripe retries
        return reply.status(500).send({ error: 'Webhook processing failed' });
      }

      return reply.status(200).send({ received: true });
    }
  );
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  log: FastifyInstance['log']
): Promise<void> {
  const organizationId = session.metadata?.organizationId;
  if (!organizationId) {
    log.warn({ sessionId: session.id }, 'checkout.session.completed: missing organizationId metadata');
    return;
  }

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? null;

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      plan: Plan.TEAM,
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscriptionId,
      stripeSubscriptionStatus: 'active',
      planUpdatedAt: new Date(),
    },
  });

  log.info({ organizationId, customerId, subscriptionId }, 'checkout.session.completed: upgraded to TEAM');
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  log: FastifyInstance['log']
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  const org = await prisma.organization.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });

  if (!org) {
    log.warn({ customerId }, 'customer.subscription.updated: org not found for customer');
    return;
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      stripeSubscriptionStatus: subscription.status,
      planUpdatedAt: new Date(),
    },
  });

  log.info(
    { orgId: org.id, customerId, status: subscription.status },
    'customer.subscription.updated: synced subscription status'
  );
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  log: FastifyInstance['log']
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  const org = await prisma.organization.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });

  if (!org) {
    log.warn({ customerId }, 'customer.subscription.deleted: org not found for customer');
    return;
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      plan: Plan.FREE,
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: 'canceled',
      planUpdatedAt: new Date(),
    },
  });

  log.info(
    { orgId: org.id, customerId },
    'customer.subscription.deleted: downgraded to FREE'
  );
}
