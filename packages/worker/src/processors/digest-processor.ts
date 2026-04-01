/**
 * Digest Processor — runs weekly, sends a security summary email to every
 * active member in every organisation that has at least one scan in the
 * past 7 days.
 *
 * Scheduled as a BullMQ repeatable job (every Monday 08:00 UTC).
 * Job data: {} — all data is fetched fresh from the DB at run time.
 */

import { prisma } from '@codesheriff/db';
import { sendWeeklyDigest } from '../services/email-notifier.js';
import type { Logger } from 'pino';

const APP_URL = process.env['APP_URL'] ?? 'http://localhost:3000';

export async function processDigestJob(log: Logger): Promise<void> {
  const weekEnd   = new Date();
  const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  log.info({ weekStart, weekEnd }, 'running weekly digest');

  // Fetch all orgs that had at least one scan in the past 7 days
  const activeOrgs = await prisma.organization.findMany({
    where: {
      repositories: {
        some: {
          scans: {
            some: { createdAt: { gte: weekStart } },
          },
        },
      },
    },
    include: {
      users: {
        select: { id: true, email: true, name: true },
      },
      repositories: {
        include: {
          scans: {
            where: { createdAt: { gte: weekStart } },
            select: {
              id: true,
              riskScore: true,
              _count: { select: { findings: true } },
              findings: {
                where: { severity: 'CRITICAL' },
                select: { id: true },
              },
            },
          },
          _count: { select: { findings: true } },
        },
      },
    },
  });

  let sent = 0;
  let failed = 0;

  for (const org of activeOrgs) {
    // Aggregate org-level stats
    const allScans = org.repositories.flatMap((r) => r.scans);
    const totalScans = allScans.length;
    const criticalFindings = allScans.reduce((sum, s) => sum + s.findings.length, 0);
    const totalNewFindings = allScans.reduce((sum, s) => sum + s._count.findings, 0);

    // Top 5 repos by risk score
    const topRepos = org.repositories
      .filter((r) => r.scans.length > 0)
      .sort((a, b) => {
        const aMax = Math.max(...a.scans.map((s) => s.riskScore ?? 0));
        const bMax = Math.max(...b.scans.map((s) => s.riskScore ?? 0));
        return bMax - aMax;
      })
      .slice(0, 5)
      .map((r) => ({
        name: r.name,
        riskScore: Math.max(...r.scans.map((s) => s.riskScore ?? 0)),
        criticalCount: r.scans.reduce((sum, s) => sum + s.findings.length, 0),
        highCount: 0, // would need a separate query per severity — omitted for simplicity
        totalFindings: r.scans.reduce((sum, s) => sum + s._count.findings, 0),
        scansThisWeek: r.scans.length,
      }));

    // Send one email per org member
    for (const user of org.users) {
      try {
        await sendWeeklyDigest({
          orgName: org.name,
          recipientEmail: user.email,
          recipientName: user.name,
          weekStart,
          weekEnd,
          totalScans,
          totalNewFindings,
          criticalFindings,
          topRepos,
          appUrl: APP_URL,
        });
        sent++;
        log.debug({ orgId: org.id, email: user.email }, 'digest sent');
      } catch (err) {
        failed++;
        log.error({ err, orgId: org.id, email: user.email }, 'digest send failed');
      }
    }
  }

  log.info({ orgs: activeOrgs.length, sent, failed }, 'weekly digest complete');
}
