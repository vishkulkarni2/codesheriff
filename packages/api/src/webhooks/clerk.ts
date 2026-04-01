/**
 * Clerk Webhook Handler — User Provisioning
 *
 * Receives Clerk webhook events and provisions users + organizations
 * in the CodeSheriff database on first sign-up.
 *
 * Events handled:
 *   - user.created  → create User + Organization records
 *   - user.updated  → sync name/email changes
 *   - user.deleted  → soft-delete or cascade (handled by DB onDelete: Cascade)
 *
 * SECURITY:
 *   - Svix signature verification (HMAC-SHA256) on raw body before processing
 *   - Webhook secret read from env — never hardcoded
 *   - Raw body required for signature verification
 *
 * Setup:
 *   1. Add CLERK_WEBHOOK_SECRET to .env (from Clerk Dashboard → Webhooks)
 *   2. Configure Clerk webhook endpoint: POST /webhooks/clerk
 *   3. Subscribe to: user.created, user.updated, user.deleted
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Webhook } from 'svix';
import { prisma } from '@codesheriff/db';
import { UserRole, Plan } from '@codesheriff/shared';

// Clerk webhook payload shapes (subset we need)
interface ClerkEmailAddress {
  email_address: string;
  id: string;
}

interface ClerkUserPayload {
  id: string;
  email_addresses: ClerkEmailAddress[];
  primary_email_address_id: string;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
  username: string | null;
  created_at: number;
}

interface ClerkWebhookEvent {
  type: 'user.created' | 'user.updated' | 'user.deleted';
  data: ClerkUserPayload | { id: string };
}

export async function clerkWebhookRoutes(app: FastifyInstance): Promise<void> {
  const webhookSecret = process.env['CLERK_WEBHOOK_SECRET'];

  if (!webhookSecret) {
    app.log.warn('CLERK_WEBHOOK_SECRET not set — Clerk webhooks disabled. New users will not be auto-provisioned.');
    return;
  }

  app.post(
    '/clerk',
    {
      config: { rawBody: true },
      // Tighter rate limit — Clerk sends at most a few events per second
      schema: { hide: true },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      // ---- Signature verification ----
      const svixId = req.headers['svix-id'] as string | undefined;
      const svixTimestamp = req.headers['svix-timestamp'] as string | undefined;
      const svixSignature = req.headers['svix-signature'] as string | undefined;

      if (!svixId || !svixTimestamp || !svixSignature) {
        req.log.warn('Clerk webhook missing svix headers');
        return reply.status(400).send({ error: 'Missing svix headers' });
      }

      const wh = new Webhook(webhookSecret);
      let event: ClerkWebhookEvent;

      try {
        const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
        if (!rawBody) {
          return reply.status(400).send({ error: 'Raw body unavailable' });
        }

        event = wh.verify(rawBody.toString(), {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
        }) as ClerkWebhookEvent;
      } catch (err) {
        req.log.warn({ err }, 'Clerk webhook signature verification failed');
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      req.log.info({ type: event.type }, 'Clerk webhook received');

      // ---- Event handlers ----
      try {
        switch (event.type) {
          case 'user.created':
            await handleUserCreated(event.data as ClerkUserPayload, req.log);
            break;

          case 'user.updated':
            await handleUserUpdated(event.data as ClerkUserPayload, req.log);
            break;

          case 'user.deleted':
            await handleUserDeleted((event.data as { id: string }).id, req.log);
            break;

          default:
            req.log.info({ type: event.type }, 'Clerk webhook: unhandled event type — ignoring');
        }
      } catch (err) {
        req.log.error({ err, eventType: event.type }, 'Clerk webhook handler failed');
        // Return 500 so Clerk retries — don't silently drop provisioning failures
        return reply.status(500).send({ error: 'Provisioning failed' });
      }

      return reply.status(200).send({ received: true });
    }
  );
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleUserCreated(
  data: ClerkUserPayload,
  log: FastifyInstance['log']
): Promise<void> {
  const primaryEmail = data.email_addresses.find(
    (e) => e.id === data.primary_email_address_id
  )?.email_address;

  if (!primaryEmail) {
    log.warn({ clerkId: data.id }, 'user.created: no primary email — skipping provisioning');
    return;
  }

  const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || primaryEmail.split('@')[0];

  // Check if user already exists (idempotent — Clerk may retry)
  const existing = await prisma.user.findUnique({ where: { clerkId: data.id } });
  if (existing) {
    log.info({ clerkId: data.id }, 'user.created: user already provisioned — skipping');
    return;
  }

  // Derive org slug from email domain or username, make unique
  const emailDomain = primaryEmail.split('@')[1] ?? 'unknown';
  const baseSlug = slugify(data.username ?? emailDomain.split('.')[0] ?? 'org');
  const slug = await uniqueSlug(baseSlug);

  // Create org + user in a transaction — either both succeed or neither does
  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: `${name}'s Organization`,
        slug,
        plan: Plan.FREE,
        seats: 3,
      },
    });

    await tx.user.create({
      data: {
        clerkId: data.id,
        email: primaryEmail,
        name,
        avatarUrl: data.image_url,
        organizationId: org.id,
        role: UserRole.OWNER,
      },
    });

    log.info(
      { clerkId: data.id, orgId: org.id, slug },
      'user.created: provisioned user + org'
    );
  });
}

async function handleUserUpdated(
  data: ClerkUserPayload,
  log: FastifyInstance['log']
): Promise<void> {
  const primaryEmail = data.email_addresses.find(
    (e) => e.id === data.primary_email_address_id
  )?.email_address;

  if (!primaryEmail) return;

  const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || primaryEmail.split('@')[0];

  const updated = await prisma.user.updateMany({
    where: { clerkId: data.id },
    data: {
      email: primaryEmail,
      name,
      avatarUrl: data.image_url,
    },
  });

  if (updated.count === 0) {
    // User doesn't exist in DB — provision them now (handles edge case where
    // user.created webhook was missed or failed on first delivery)
    log.warn({ clerkId: data.id }, 'user.updated: user not found — provisioning now');
    await handleUserCreated(data, log);
    return;
  }

  log.info({ clerkId: data.id }, 'user.updated: synced user record');
}

async function handleUserDeleted(
  clerkId: string,
  log: FastifyInstance['log']
): Promise<void> {
  // Prisma schema has onDelete: Cascade on User → Organization
  // Deleting the user cascades to findings, scans, etc. via repo → org
  // For now we delete the user record — org persists if other members exist
  const deleted = await prisma.user.deleteMany({ where: { clerkId } });

  if (deleted.count === 0) {
    log.warn({ clerkId }, 'user.deleted: user not found in DB — nothing to delete');
    return;
  }

  log.info({ clerkId }, 'user.deleted: user record removed');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'org';
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let attempts = 0;

  while (attempts < 10) {
    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (!existing) return slug;
    attempts++;
    slug = `${base}-${attempts}`;
  }

  // Fallback: append random suffix
  slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  return slug;
}
