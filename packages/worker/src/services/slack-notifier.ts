/**
 * Slack Notifier — sends post-scan notifications to an org's Slack workspace
 * via an Incoming Webhook URL.
 *
 * Notifications use Slack Block Kit for a structured, readable layout:
 *   - Scan outcome header (complete / failed)
 *   - Repository + branch + commit
 *   - Risk score with colour-coded emoji
 *   - Findings breakdown (critical / high / medium / low)
 *   - Direct link to the CodeSheriff scan page
 *   - Optional PR context when the scan was triggered by a pull request
 *
 * The function is intentionally fire-and-forget — callers should handle
 * errors gracefully so a Slack failure never blocks scan completion.
 */

import { Severity, getRiskLevel } from '@codesheriff/shared';

export interface SlackNotificationPayload {
  /** Org's Slack incoming webhook URL */
  webhookUrl: string;
  /** Database scan ID */
  scanId: string;
  /** Whether the scan succeeded or failed */
  outcome: 'complete' | 'failed';
  /** Repository full name, e.g. "acme-corp/backend-api" */
  repoFullName: string;
  /** Branch name */
  branch: string;
  /** Full 40-char commit SHA */
  commitSha: string;
  /** Risk score 0–100. Null if scan failed before scoring. */
  riskScore: number | null;
  /** Counts populated on success */
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  /** Optional PR context */
  prNumber?: number | null;
  prTitle?: string | null;
  /** Base URL of the CodeSheriff frontend, e.g. "https://app.thecodesheriff.com" */
  frontendUrl: string;
}

/**
 * Sends a Slack notification for a completed or failed scan.
 * Throws on network or HTTP error so callers can log and ignore.
 */
export async function sendSlackNotification(payload: SlackNotificationPayload): Promise<void> {
  const body = buildSlackPayload(payload);

  const res = await fetch(payload.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Slack webhooks respond within a few hundred ms — 10 s is generous
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable body)');
    throw new Error(`Slack webhook returned ${res.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Block Kit payload builder
// ---------------------------------------------------------------------------

function buildSlackPayload(payload: SlackNotificationPayload): object {
  const {
    scanId,
    outcome,
    repoFullName,
    branch,
    commitSha,
    riskScore,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    prNumber,
    prTitle,
    frontendUrl,
  } = payload;

  const scanUrl = `${frontendUrl}/scans/${scanId}`;
  const shortSha = commitSha.slice(0, 8);
  const isComplete = outcome === 'complete';

  // Attachment colour: red for critical risk, orange for high, yellow for
  // medium, green for low/clean, grey for failed scans.
  const colour = !isComplete
    ? '#95a5a6'
    : riskScore === null
      ? '#95a5a6'
      : riskScore >= 75
        ? '#e74c3c'
        : riskScore >= 50
          ? '#e67e22'
          : riskScore >= 25
            ? '#f1c40f'
            : '#2ecc71';

  const headerEmoji = isComplete
    ? riskScore !== null && riskScore >= 75
      ? '🚨'
      : '✅'
    : '❌';

  const headerText = isComplete
    ? `${headerEmoji} CodeSheriff scan complete — ${repoFullName}`
    : `${headerEmoji} CodeSheriff scan failed — ${repoFullName}`;

  const blocks: object[] = [
    // Header
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: headerText,
        emoji: true,
      },
    },

    // Repo / branch / commit fields
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Repository*\n<https://github.com/${repoFullName}|${repoFullName}>`,
        },
        {
          type: 'mrkdwn',
          text: `*Branch & Commit*\n\`${branch}\` @ \`${shortSha}\``,
        },
      ],
    },
  ];

  // PR context row (shown when scan was triggered by a pull request)
  if (prNumber) {
    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Pull Request*\n<https://github.com/${repoFullName}/pull/${prNumber}|#${prNumber}${prTitle ? ` — ${prTitle.slice(0, 80)}` : ''}>`,
        },
      ],
    });
  }

  if (isComplete) {
    // Risk score + findings breakdown
    const riskEmoji = riskScore === null
      ? '⬜'
      : getRiskLevel(riskScore) === 'critical'
        ? '🔴'
        : getRiskLevel(riskScore) === 'high'
          ? '🟠'
          : getRiskLevel(riskScore) === 'medium'
            ? '🟡'
            : '🟢';

    const findingsSummary = [
      criticalCount > 0 ? `🔴 *${criticalCount}* Critical` : null,
      highCount > 0 ? `🟠 *${highCount}* High` : null,
      mediumCount > 0 ? `🟡 *${mediumCount}* Medium` : null,
      lowCount > 0 ? `⚪ *${lowCount}* Low` : null,
    ]
      .filter(Boolean)
      .join('   ');

    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Risk Score*\n${riskEmoji} *${riskScore ?? 'N/A'}* / 100`,
        },
        {
          type: 'mrkdwn',
          text: `*Findings*\n${findingsSummary || '✅ None found'}`,
        },
      ],
    });
  }

  // Divider + action button
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '🔍 View Scan', emoji: true },
        url: scanUrl,
        style: isComplete && riskScore !== null && riskScore >= 75 ? 'danger' : 'primary',
      },
    ],
  });

  // Context footer
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Sent by <https://thecodesheriff.com|CodeSheriff> · <${scanUrl}|View full report>`,
      },
    ],
  });

  return {
    attachments: [
      {
        color: colour,
        blocks,
      },
    ],
  };
}

/**
 * Validates that a webhook URL has the expected Slack format.
 * This is a syntactic check — it does not verify the token is live.
 */
export function isValidSlackWebhookUrl(url: string): boolean {
  return /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+$/.test(
    url
  );
}
