/**
 * Core enumerations used across all CodeSheriff services.
 * These map 1:1 to the Prisma schema enums.
 */

/** Subscription plan tiers for an Organization */
export enum Plan {
  FREE = 'FREE',
  TEAM = 'TEAM',
  ENTERPRISE = 'ENTERPRISE',
}

/** User role within an Organization */
export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

/** Source control provider */
export enum Provider {
  GITHUB = 'GITHUB',
  GITLAB = 'GITLAB',
  BITBUCKET = 'BITBUCKET',
}

/** How a scan was initiated */
export enum ScanTrigger {
  PUSH = 'PUSH',
  PR = 'PR',
  MANUAL = 'MANUAL',
  SCHEDULED = 'SCHEDULED',
}

/** Lifecycle status of a scan job */
export enum ScanStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETE = 'COMPLETE',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Finding severity — maps to CVSS-inspired levels */
export enum Severity {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  INFO = 'INFO',
}

/** Category of finding — determines which detector produced it */
export enum FindingCategory {
  SECURITY = 'SECURITY',
  HALLUCINATION = 'HALLUCINATION',
  AUTH = 'AUTH',
  LOGIC = 'LOGIC',
  SECRET = 'SECRET',
  QUALITY = 'QUALITY',
}

/** Numeric severity weights for risk scoring */
export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  [Severity.CRITICAL]: 40,
  [Severity.HIGH]: 20,
  [Severity.MEDIUM]: 8,
  [Severity.LOW]: 2,
  [Severity.INFO]: 0,
};

/** Maximum risk score (normalized ceiling) */
export const MAX_RISK_SCORE = 100;
