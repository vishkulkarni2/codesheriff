# CodeSheriff Knowledge Base

## What is CodeSheriff?

CodeSheriff is an AI-powered code security scanner for GitHub repositories. It catches vulnerabilities that traditional static analysis tools miss:

- SQL injection
- Cross-site scripting (XSS)
- Hardcoded secrets (API keys, passwords, tokens)
- Authentication and authorization bugs
- Hallucinated API calls (APIs that don't exist, wrong method signatures)
- Logic flaws (off-by-one errors, race conditions, incorrect null checks)

CodeSheriff supports **6 languages**: JavaScript, TypeScript, Python, Java, Go, and Ruby.

Unlike simple linters, CodeSheriff uses a multi-stage AI pipeline that understands code context, data flow, and intent -- not just pattern matching.

## Getting Started

1. **Sign up** at [app.thecodesheriff.com](https://app.thecodesheriff.com)
2. **Install the GitHub App**: Go to [github.com/apps/codesheriff-review](https://github.com/apps/codesheriff-review) and click "Install"
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

Go to [github.com/apps/codesheriff-review](https://github.com/apps/codesheriff-review), click "Install", and select the organization/repos you want to scan.

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
- This bot (you're using it now!)
- For enterprise customers: your dedicated Slack channel

## Troubleshooting

### Scan stuck at QUEUED

The scan worker may be restarting. Wait 5 minutes and check again. If the scan is still stuck after 5 minutes, please contact support at support@thecodesheriff.com.

### No PR comments appearing

Check the following:
1. Is the GitHub App installed with `checks:write` permission?
2. Is this scan for a pull request (not just a branch push)? PR comments only appear on pull request scans.
3. Go to GitHub Settings > Applications > codesheriff-review > Permissions and verify the app has the required permissions.

### Dashboard shows "Application error"

1. Clear your browser cache
2. Hard refresh the page (Cmd+Shift+R or Ctrl+Shift+R)
3. Try a different browser or incognito window
4. If the error persists, contact support at support@thecodesheriff.com
