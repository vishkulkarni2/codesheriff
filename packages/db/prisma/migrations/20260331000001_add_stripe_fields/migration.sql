-- Migration: add Stripe billing fields to Organization
-- Enables Stripe customer/subscription tracking for FREE → TEAM plan upgrades.

ALTER TABLE "Organization"
  ADD COLUMN "stripeCustomerId"         TEXT UNIQUE,
  ADD COLUMN "stripeSubscriptionId"     TEXT UNIQUE,
  ADD COLUMN "stripeSubscriptionStatus" TEXT,
  ADD COLUMN "planUpdatedAt"            TIMESTAMP(3);
