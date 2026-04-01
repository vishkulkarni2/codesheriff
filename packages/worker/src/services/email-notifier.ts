/**
 * Email Notifier — sends weekly digest emails via Resend.
 *
 * Required env vars:
 *   RESEND_API_KEY      — from resend.com dashboard
 *   DIGEST_FROM_EMAIL   — verified sender address, e.g. "digest@codesheriff.io"
 *   APP_URL             — public frontend URL for links, e.g. "https://app.codesheriff.io"
 */

import { Resend } from 'resend';

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env['RESEND_API_KEY'];
    if (!key) throw new Error('RESEND_API_KEY is not set');
    _resend = new Resend(key);
  }
  return _resend;
}

export interface DigestRepo {
  name: string;
  riskScore: number;
  criticalCount: number;
  highCount: number;
  totalFindings: number;
  scansThisWeek: number;
}

export interface WeeklyDigestPayload {
  orgName: string;
  recipientEmail: string;
  recipientName: string | null;
  weekStart: Date;
  weekEnd: Date;
  totalScans: number;
  totalNewFindings: number;
  criticalFindings: number;
  topRepos: DigestRepo[];
  appUrl: string;
}

export async function sendWeeklyDigest(payload: WeeklyDigestPayload): Promise<void> {
  const resend = getResend();
  const from = process.env['DIGEST_FROM_EMAIL'] ?? 'digest@codesheriff.io';

  const { orgName, recipientEmail, recipientName, weekStart, weekEnd } = payload;
  const name = recipientName ?? (recipientEmail.split('@')[0] ?? recipientEmail);
  const period = `${fmt(weekStart)} – ${fmt(weekEnd)}`;

  const html = buildDigestHtml(payload, name, period);
  const text = buildDigestText(payload, name, period);

  await resend.emails.send({
    from: `CodeSheriff <${from}>`,
    to: recipientEmail,
    subject: `${orgName} weekly security digest — ${period}`,
    html,
    text,
  });
}

function fmt(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function riskEmoji(score: number): string {
  if (score >= 75) return '🔴';
  if (score >= 50) return '🟠';
  if (score >= 25) return '🟡';
  return '🟢';
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function buildDigestHtml(p: WeeklyDigestPayload, name: string, period: string): string {
  const repoRows = p.topRepos
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${riskEmoji(r.riskScore)} ${r.riskScore}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#dc2626;">${r.criticalCount}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${r.totalFindings}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${r.scansThisWeek}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">

    <!-- Header -->
    <div style="background:#0f172a;padding:24px 32px;display:flex;align-items:center;gap:12px;">
      <span style="font-size:20px;">🛡️</span>
      <span style="color:#fff;font-size:18px;font-weight:700;">CodeSheriff</span>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <h1 style="margin:0 0 4px;font-size:22px;color:#0f172a;">Weekly digest</h1>
      <p style="margin:0 0 24px;color:#64748b;font-size:14px;">${period} · ${p.orgName}</p>

      <p style="color:#374151;font-size:15px;">Hi ${name},</p>
      <p style="color:#374151;font-size:15px;">Here's your security summary for the past week.</p>

      <!-- KPIs -->
      <div style="display:flex;gap:16px;margin:24px 0;">
        <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#0f172a;">${p.totalScans}</div>
          <div style="font-size:13px;color:#64748b;margin-top:4px;">Scans run</div>
        </div>
        <div style="flex:1;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#dc2626;">${p.criticalFindings}</div>
          <div style="font-size:13px;color:#64748b;margin-top:4px;">Critical findings</div>
        </div>
        <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#0f172a;">${p.totalNewFindings}</div>
          <div style="font-size:13px;color:#64748b;margin-top:4px;">Total findings</div>
        </div>
      </div>

      <!-- Top repos table -->
      ${p.topRepos.length > 0 ? `
      <h2 style="font-size:16px;color:#0f172a;margin:24px 0 12px;">Top repositories</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px 12px;text-align:left;color:#64748b;font-weight:600;">Repository</th>
            <th style="padding:8px 12px;text-align:center;color:#64748b;font-weight:600;">Risk</th>
            <th style="padding:8px 12px;text-align:center;color:#64748b;font-weight:600;">Critical</th>
            <th style="padding:8px 12px;text-align:center;color:#64748b;font-weight:600;">Findings</th>
            <th style="padding:8px 12px;text-align:center;color:#64748b;font-weight:600;">Scans</th>
          </tr>
        </thead>
        <tbody>${repoRows}</tbody>
      </table>` : ''}

      <!-- CTA -->
      <div style="margin:32px 0;text-align:center;">
        <a href="${p.appUrl}/dashboard"
           style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
          View full dashboard →
        </a>
      </div>

      <p style="color:#94a3b8;font-size:12px;margin:0;">
        You're receiving this because you're a member of ${p.orgName} on CodeSheriff.
        Digest emails are sent every Monday at 08:00 UTC.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Plain-text fallback
// ---------------------------------------------------------------------------

function buildDigestText(p: WeeklyDigestPayload, name: string, period: string): string {
  const repoLines = p.topRepos
    .map(
      (r) =>
        `  ${r.name}: risk ${r.riskScore}, ${r.criticalCount} critical, ${r.totalFindings} total findings, ${r.scansThisWeek} scans`
    )
    .join('\n');

  return `CodeSheriff — Weekly digest
${period} · ${p.orgName}

Hi ${name},

SUMMARY
-------
Scans run:        ${p.totalScans}
Critical findings: ${p.criticalFindings}
Total findings:    ${p.totalNewFindings}

${p.topRepos.length > 0 ? `TOP REPOSITORIES\n----------------\n${repoLines}\n` : ''}
View dashboard: ${p.appUrl}/dashboard

---
You're receiving this because you're a member of ${p.orgName} on CodeSheriff.
`;
}
