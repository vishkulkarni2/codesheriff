/**
 * Billing routes — Stripe Checkout & Customer Portal
 *
 * POST /api/v1/billing/checkout  — create Stripe Checkout session (FREE → TEAM upgrade)
 * POST /api/v1/billing/portal    — create Stripe Customer Portal session (manage/cancel)
 * GET  /api/v1/billing/status    — return current plan, subscription status, stripeCustomerId
 *
 * All routes require Clerk JWT authentication via app.authenticate.
 * Org identity comes from req.dbUser.organizationId — never from request body.
 *
 * SECURITY:
 *   - Stripe secret key read from environment only
 *   - Customer creation is idempotent (stripeCustomerId stored on org)
 *   - Org scoping enforced via verified JWT, not client-supplied IDs
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '@codesheriff/db';
import { getStripe } from '../lib/stripe.js';

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // GET /api/v1/billing/status
  // ---------------------------------------------------------------------------
  app.get('/billing/status', { preHandler: [app.authenticate] }, async (req, reply) => {
    const orgId = req.dbUser!.organizationId;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        plan: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        stripeSubscriptionStatus: true,
        planUpdatedAt: true,
      },
    });

    if (!org) {
      return reply.status(404).send({ success: false, data: null, error: 'Organization not found' });
    }

    return reply.send({
      success: true,
      data: {
        plan: org.plan,
        stripeCustomerId: org.stripeCustomerId,
        stripeSubscriptionId: org.stripeSubscriptionId,
        stripeSubscriptionStatus: org.stripeSubscriptionStatus,
        planUpdatedAt: org.planUpdatedAt,
      },
      error: null,
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/billing/checkout
  // ---------------------------------------------------------------------------
  app.post('/billing/checkout', { preHandler: [app.authenticate] }, async (req, reply) => {
    const orgId = req.dbUser!.organizationId;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        stripeCustomerId: true,
      },
    });

    if (!org) {
      return reply.status(404).send({ success: false, data: null, error: 'Organization not found' });
    }

    const priceId = process.env['STRIPE_TEAM_PRICE_ID'];
    if (!priceId) {
      req.log.error('STRIPE_TEAM_PRICE_ID is not set');
      return reply.status(500).send({
        success: false,
        data: null,
        error: 'Billing not configured',
      });
    }

    const stripe = getStripe();

    // Retrieve or create the Stripe customer (idempotent via stored stripeCustomerId)
    let customerId = org.stripeCustomerId;

    if (!customerId) {
      // Try to find existing customer by email before creating a new one
      const userEmail = req.dbUser!.email;
      const existing = await stripe.customers.list({ email: userEmail, limit: 1 });

      if (existing.data.length > 0) {
        customerId = existing.data[0]!.id;
      } else {
        const customer = await stripe.customers.create({
          email: userEmail,
          name: org.name,
          metadata: { organizationId: orgId },
        });
        customerId = customer.id;
      }

      // Persist the customer ID so future calls are idempotent
      await prisma.organization.update({
        where: { id: orgId },
        data: { stripeCustomerId: customerId },
      });
    }

    const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/settings?upgraded=true`,
      cancel_url: `${frontendUrl}/pricing`,
      metadata: { organizationId: orgId },
    });

    return reply.send({ success: true, data: { url: session.url }, error: null });
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/billing/cancel
  // ---------------------------------------------------------------------------
  app.post('/billing/cancel', { preHandler: [app.authenticate] }, async (req, reply) => {
    const orgId = req.dbUser!.organizationId;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { stripeSubscriptionId: true, stripeCustomerId: true },
    });

    if (!org?.stripeSubscriptionId) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: 'No active subscription to cancel.',
      });
    }

    const stripe = getStripe();

    // Cancel at period end so the user retains access until the billing cycle ends.
    // When the period ends, Stripe fires customer.subscription.deleted and our
    // webhook handler downgrades the org to FREE.
    const subscription = await stripe.subscriptions.update(org.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    // Sync the status immediately so the UI can reflect the pending cancellation
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        stripeSubscriptionStatus: subscription.status,
        planUpdatedAt: new Date(),
      },
    });

    return reply.send({
      success: true,
      data: { cancelAtPeriodEnd: true, currentPeriodEnd: subscription.current_period_end },
      error: null,
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/billing/portal
  // ---------------------------------------------------------------------------
  app.post('/billing/portal', { preHandler: [app.authenticate] }, async (req, reply) => {
    const orgId = req.dbUser!.organizationId;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { stripeCustomerId: true },
    });

    if (!org?.stripeCustomerId) {
      return reply.status(400).send({
        success: false,
        data: null,
        error: 'No billing account found. Please upgrade first.',
      });
    }

    const stripe = getStripe();
    const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${frontendUrl}/settings`,
    });

    return reply.send({ success: true, data: { url: portalSession.url }, error: null });
  });
}
