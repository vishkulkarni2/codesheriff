-- Migration: add slackWebhookUrl to Organization
-- Allows per-org Slack incoming webhook configuration for post-scan notifications.

ALTER TABLE "Organization"
  ADD COLUMN "slackWebhookUrl" TEXT;
