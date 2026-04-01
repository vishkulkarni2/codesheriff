/**
 * @codesheriff/db — public exports
 *
 * Re-exports the Prisma client singleton plus all generated types
 * so consumers only need to import from '@codesheriff/db'.
 */

export { prisma, PrismaClient } from './client.js';

// Re-export all Prisma-generated types for convenience
export type {
  Organization,
  User,
  Repository,
  Scan,
  Finding,
  Rule,
  RiskHistory,
  VcsInstallation,
  Prisma,
} from '@prisma/client';

// Re-export enums from Prisma (they are runtime values, not just types)
export {
  Plan,
  UserRole,
  Provider,
  ScanTrigger,
  ScanStatus,
  Severity,
  FindingCategory,
} from '@prisma/client';
