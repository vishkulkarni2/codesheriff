/**
 * Support chat route — AI-powered support using the CodeSheriff knowledge base.
 *
 * Works WITHOUT auth (for future marketing site widget) but includes user
 * context if an Authorization header is present.
 *
 * Rate limited to 10 requests per minute per IP.
 */

import type { FastifyInstance } from 'fastify';

// Knowledge base inlined to avoid file I/O path issues in Docker/Render.
// TypeScript's tsc doesn't copy .md files to dist/, so readFileSync from
// __dirname would crash with ENOENT at runtime. Inlining is ugly but
// reliable in every deployment environment.
//
// Source of truth: packages/api/src/knowledge-base.md (update both if editing).
const knowledgeBase = `# CodeSheriff Knowledge Base

## What is CodeSheriff?

CodeSheriff is an AI-powered code security scanner for GitHub repositories. It catches vulnerabilities that traditional static analysis tools miss:

- SQL injection
- Cross-site scripting (XSS)
- Hardcoded secrets (API keys, passwords, tokens)
- Authentication and authorization bugs
- Hallucinated API calls (APIs that don't exist, wrong method signatures)
- Logic flaws (off-by-one errors, race conditions, incorrect null checks)

CodeSheriff supports **6 languages**: JavaScript, TypeScript, Python, Java, Go, and Ruby.

Unlike simple linters, CodeSheriff uses a multi-stage AI pipeline that understands code context, data flow, and intent, not just pattern matching.

## Getting Started

1. **Sign up** at app.thecodesheriff.com
2. **Install the GitHub App**: Go to github.com/apps/codesheriff-review and click "Install"
3. **Select repositories**: Choose which repos CodeSheriff should scan
4. **Push code or open a PR**: CodeSheriff scans automatically on push events and pull requests
5. **View findings**: Results appear in the CodeSheriff dashboard and as inline PR review comments

## Pricing

| Plan | Price | What you get |
|------|-------|-------------|
| **Free** | $0/month | 1 repo, static analysis only |
| **Pro** | $29/dev/month | All repos, full AI pipeline, auto-fix suggestions, Slack integration, SARIF export |
| **Scale** | $25/dev/month (min 20 devs) | Everything in Pro + custom rules, SSO, priority support |
| **Enterprise** | Custom pricing | Dedicated infrastructure, SLA, custom integrations |

### How to upgrade

Go to Dashboard > Pricing > Upgrade. Select your plan and enter payment details.

## Frequently Asked Questions

### How do I install the GitHub App?

Go to github.com/apps/codesheriff-review, click "Install", and select the organization/repos you want to scan.

### Why don't I see any findings?

Check the following:
1. Is the GitHub App installed on the repo?
2. Did the scan complete? Check the dashboard for scan status.
3. Is the file in a supported language (JS, TS, Python, Java, Go, Ruby)?
4. If the scan shows "QUEUED", the worker may be restarting. Wait 5 minutes.

### What languages are supported?

JavaScript, TypeScript, Python, Java, Go, and Ruby.

### How do I add more repos?

The Free plan supports 1 repo only. Upgrade to Pro for unlimited repos. Once on Pro, install the GitHub App on additional repos via GitHub Settings > Applications > codesheriff-review > Configure.

### What's the difference between Free and Pro?

- **Free**: Static analysis only (pattern-based detection). 1 repo.
- **Pro**: Full AI pipeline including hallucination detection, auth bug detection, logic flaw analysis, auto-fix suggestions, Slack notifications, and SARIF export. Unlimited repos.

### How do I suppress a false positive?

In the dashboard, click on the finding you want to suppress. Click the "Suppress" button and enter a reason. Suppressed findings won't appear in future scans.

### Can I use CodeSheriff on GitLab?

GitLab support is coming soon. Currently, CodeSheriff works with GitHub only.

### How do I export findings?

On Pro plan and above: go to the scan detail page and click the "Export SARIF" button. This exports findings in the standard SARIF format compatible with other security tools.

### Is my code sent to the cloud?

CodeSheriff fetches file content via GitHub's API for analysis. Code is processed in memory during the scan and is not stored after the scan completes. No code is retained on CodeSheriff servers after analysis.

### How do I contact support?

- Email: support@thecodesheriff.com
- Use the chat widget on the dashboard (you might be using it now)
- For enterprise customers: your dedicated Slack channel

## Troubleshooting

### Scan stuck at QUEUED

The scan worker may be restarting. Wait 5 minutes and check again. If the scan is still stuck after 5 minutes, please contact support at support@thecodesheriff.com.

### No PR comments appearing

Check the following:
1. Is the GitHub App installed with checks:write permission?
2. Is this scan for a pull request (not just a branch push)? PR comments only appear on pull request scans.
3. Go to GitHub Settings > Applications > codesheriff-review > Permissions and verify the app has the required permissions.

### Dashboard shows "Application error"

1. Clear your browser cache
2. Hard refresh the page (Cmd+Shift+R or Ctrl+Shift+R)
3. Try a different browser or incognito window
4. If the error persists, contact support at support@thecodesheriff.com
`;

const SYSTEM_PROMPT = `${knowledgeBase}

---

You are CodeSheriff Support. Answer questions about CodeSheriff using ONLY the knowledge base above. Be helpful, concise, and technical. If you cannot answer from the knowledge base, say you will escalate to the team.`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  message: string;
  history?: ChatMessage[];
}

export async function supportRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ChatRequestBody }>(
    '/support/chat',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      const { message, history = [] } = req.body ?? {};

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        void reply.status(400).send({
          success: false,
          data: null,
          error: 'message is required and must be a non-empty string',
        });
        return;
      }

      if (message.length > 2000) {
        void reply.status(400).send({
          success: false,
          data: null,
          error: 'message must be 2000 characters or fewer',
        });
        return;
      }

      const apiKey = process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) {
        req.log.error('ANTHROPIC_API_KEY is not set');
        void reply.status(503).send({
          success: false,
          data: null,
          error: 'Support chat is temporarily unavailable',
        });
        return;
      }

      // Build messages array for the Anthropic API
      const messages = [
        ...history.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: 'user' as const, content: message },
      ];

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6-20250514',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          req.log.error(
            { status: response.status, body: errorBody },
            'Anthropic API error'
          );
          void reply.status(502).send({
            success: false,
            data: null,
            error: 'Failed to get response from support AI',
          });
          return;
        }

        const data = (await response.json()) as {
          content: Array<{ type: string; text: string }>;
        };

        const replyText =
          data.content
            ?.filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('') ?? 'Sorry, I could not generate a response.';

        void reply.status(200).send({
          success: true,
          data: { reply: replyText },
          error: null,
        });
      } catch (err) {
        req.log.error({ err }, 'Support chat request failed');
        void reply.status(500).send({
          success: false,
          data: null,
          error: 'Internal server error',
        });
      }
    }
  );
}
