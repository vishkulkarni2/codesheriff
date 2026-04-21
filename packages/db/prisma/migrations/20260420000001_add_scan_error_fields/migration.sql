-- Migration: add persistent error fields to Scan for failure triage
-- Shape mirrors the Redis scan_error stash introduced in commit 911d5dd.
-- All columns nullable — no backfill, no data transforms.

ALTER TABLE "Scan"
  ADD COLUMN "errorMessage" TEXT,
  ADD COLUMN "errorType"    TEXT,
  ADD COLUMN "errorStack"   TEXT;
