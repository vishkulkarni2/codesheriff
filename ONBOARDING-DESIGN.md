# CodeSheriff User Onboarding -- Design Document

Last updated: 2026-04-06

This document covers the full user onboarding flow from initial signup through first scan results. It is written to be specific enough that any developer on the team can pick up and implement any section.

---

## Table of Contents

1. [Signup Flow](#1-signup-flow)
2. [Onboarding Wizard](#2-onboarding-wizard)
3. [GitHub App Installation Flow](#3-github-app-installation-flow)
4. [Repository Connection](#4-repository-connection)
5. [First Scan Experience](#5-first-scan-experience)
6. [Billing Integration](#6-billing-integration)
7. [Team Management](#7-team-management)
8. [Error Handling and Resilience](#8-error-handling-and-resilience)
9. [Database Schema Changes](#9-database-schema-changes)
10. [API Endpoint Specs](#10-api-endpoint-specs)

---

## 1. Signup Flow

### How it works today

1. User visits `app.thecodesheriff.com` and clicks Sign Up.
2. Clerk handles the auth UI (Google OAuth or email/password).
3. Clerk creates the user on their side and fires a `user.created` webhook to `https://api.thecodesheriff.com/webhooks/clerk`.
4. Our webhook handler (`packages/api/src/webhooks/clerk.ts`) verifies the Svix signature, then creates a `User` and `Organization` record in a single database transaction.
5. The user lands on `/dashboard` with a valid Clerk session.

### What the webhook does on `user.created`

- Extracts the primary email, name, and avatar URL from the Clerk payload.
- Creates an `Organization` with a slugified name (derived from username or email domain), defaulting to the FREE plan with 3 seats.
- Creates a `User` linked to that organization with role `OWNER`.
- The handler is idempotent. If the user already exists (Clerk retried), it skips.

### What the webhook does on `user.updated`

- Syncs name, email, and avatar changes.
- If the user does not exist in the DB (missed `user.created`), it provisions them as if `user.created` had fired. This is the self-healing fallback.

### What the webhook does on `user.deleted`

- Deletes the `User` record. The Prisma schema has `onDelete: Cascade` from User to Organization, so if the deleted user was the last member, the org and all its data cascade-delete.

### Post-signup redirect

Clerk is configured with `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard`. The dashboard page needs to detect whether the user has completed onboarding and show the wizard if not.

---

## 2. Onboarding Wizard

### Detection logic

When the dashboard loads, the frontend calls `GET /api/v1/dashboard/me`. The response includes the user's organization. If the organization has no `githubInstallationId` set, the user has not completed onboarding. Show the wizard.

### Step 1: Name your organization

**What the user sees:** A simple form with one text field pre-filled with the auto-generated org name (e.g., "Vish's Organization"). A "Continue" button.

**What happens on submit:** `PATCH /api/v1/orgs/:orgId` with `{ name: "Acme Corp" }`. The slug also gets regenerated from the new name (if the user wants to change it, there is an optional slug field shown as a subtle "Edit URL" link).

**UI notes:**
- Show the org avatar as the first letter of the name in a colored circle.
- Validate: name must be 2-50 characters, no special characters beyond hyphens and spaces.
- Slug must be unique. If taken, show inline error: "That URL is already in use. Try another."

### Step 2: Install the GitHub App

**What the user sees:** A card with the GitHub logo, a short explanation ("Connect GitHub to let CodeSheriff analyze your repositories"), and a button: "Install GitHub App". Below the button, a muted note: "You will be redirected to GitHub to authorize the app."

**What happens on click:** Redirect to `https://github.com/apps/codesheriff-review/installations/new?state={orgId}`. The `state` parameter lets us link the installation back to the org when GitHub sends the callback.

**After GitHub redirects back:** GitHub redirects to our configured callback URL with `installation_id` and `setup_action=install` as query params. The frontend sends `POST /api/v1/orgs/:orgId/github/link` with `{ installationId }`. The API stores the `githubInstallationId` on the Organization and creates a `VcsInstallation` record with the encrypted token.

**UI notes:**
- If the user already has the app installed (maybe they installed it before signing up), show a "Link existing installation" option that lists their GitHub orgs/accounts.
- Show a "Skip for now" link at the bottom. Skipping drops them into an empty dashboard with a prompt to connect GitHub whenever they are ready.

### Step 3: Select repositories

**What the user sees:** A list of repositories accessible through the GitHub App installation. Each repo shows its name, visibility (public/private badge), primary language, and a toggle switch.

**Data source:** `GET /api/v1/orgs/:orgId/github/repos` -- this calls the GitHub API using the installation token to list all repos the installation has access to.

**What happens on toggle:** Activating a repo calls `POST /api/v1/repos` with `{ fullName, provider: "GITHUB", defaultBranch, isPrivate, language }`. Deactivating calls `DELETE /api/v1/repos/:repoId`.

**Free tier limit:** If the org is on the FREE plan, only 1 repo can be activated. When the user tries to toggle a second one, show an inline upgrade prompt: "Free plan includes 1 repository. Upgrade to Pro for unlimited repos."

**UI notes:**
- Show a search/filter bar at the top for users with lots of repos.
- Group by GitHub org if the installation spans multiple orgs.
- Show a "Select all" checkbox for paid users.
- Repos that are already activated (from a previous session) should show as toggled on.

### Step 4: First scan runs automatically

**What the user sees:** After selecting at least one repo, the wizard transitions to a progress screen. It shows each selected repo with a progress indicator (queued, scanning, complete).

**What happens behind the scenes:** When a repo is activated via `POST /api/v1/repos`, the API enqueues a scan job for the default branch. The worker picks it up, clones the repo, runs semgrep + the AI detectors, and writes findings to the DB.

**Progress polling:** The frontend polls `GET /api/v1/repos/:repoId/scans?limit=1` every 3 seconds. When the scan status is `COMPLETE` or `FAILED`, update the UI accordingly. (We should move to WebSockets or SSE eventually, but polling is fine for v1.)

**UI notes:**
- Show a small animation while scanning (a magnifying glass moving across code lines, something simple).
- Display estimated time: "Usually takes 30-60 seconds".
- If the scan fails, show a "Retry" button and a brief error message. Do not block the user from continuing.
- Once at least one scan is complete, show a "View Results" button that takes them to step 5.

### Step 5: View results

**What the user sees:** The standard dashboard view, but with a first-run overlay or highlight that explains the key sections:
- Risk score badge (explain what the number means)
- Findings list (explain severity levels)
- The "AI Pattern" badge on findings that are AI-code-specific

**Implementation:** This is a lightweight tooltip tour using something like `react-joyride` or a custom component. Store a `hasSeenTour` flag in localStorage. Show once, then never again.

After dismissing the tour, the user is on the regular dashboard. Onboarding is done.

---

## 3. GitHub App Installation Flow

### Webhook: `installation.created`

When a user installs the GitHub App, GitHub sends a webhook to `POST /webhooks/github` with event type `installation` and action `created`.

**Handler logic (already partially implemented in `packages/api/src/webhooks/github.ts`):**

1. Extract `installation.id`, `installation.account.login`, and `sender.id` from the payload.
2. Look up the Organization by matching the `state` parameter (orgId) that was passed during the install redirect. If no state, fall back to matching by the GitHub org/user login against existing org slugs.
3. Set `organization.githubInstallationId = installation.id`.
4. Create a `VcsInstallation` record: `{ organizationId, provider: GITHUB, installationId: installation.id, encryptedToken: null }`. (GitHub App installations use JWT-based token generation, not stored tokens. The `encryptedToken` field stays null for GitHub; we generate short-lived installation tokens on the fly.)
5. Store the list of repositories from `installation.repositories` as lightweight cached entries (or just fetch them on demand from the API when the user reaches step 3 of the wizard).

### Webhook: `installation.deleted`

When the user uninstalls the GitHub App:

1. Find the Organization with matching `githubInstallationId`.
2. Set `githubInstallationId = null`.
3. Mark all GITHUB-provider repos under that org as disconnected (we do not delete them -- the scan history is valuable).
4. Delete the `VcsInstallation` record.
5. Send an email notification to the org owner: "Your GitHub connection has been removed."

### Webhook: `installation_repositories.added` / `installation_repositories.removed`

When the user changes which repos the app can access (in GitHub settings):

- `added`: No immediate action needed. The repos will show up next time the user visits the repo selection screen.
- `removed`: If any of the removed repos are in our `Repository` table, mark them as disconnected. Stop processing webhooks for those repos. Keep scan history.

---

## 4. Repository Connection

### Listing available repos

**Endpoint:** `GET /api/v1/orgs/:orgId/github/repos`

This endpoint fetches repos from the GitHub API using the org's installation token. It is not a database query -- it is a pass-through to GitHub with caching.

**Implementation:**

1. Generate a short-lived installation access token using the GitHub App JWT + the org's `githubInstallationId`.
2. Call `GET /installation/repositories` on the GitHub API.
3. Cache the result in Redis for 5 minutes (key: `github:repos:{installationId}`).
4. Return the list with our own repo IDs attached for any that are already in the database.

**Response shape:**

```json
{
  "repos": [
    {
      "githubId": 123456,
      "fullName": "acme-corp/backend-api",
      "name": "backend-api",
      "isPrivate": true,
      "defaultBranch": "main",
      "language": "TypeScript",
      "connected": true,
      "repoId": "clxyz..."
    },
    {
      "githubId": 789012,
      "fullName": "acme-corp/frontend",
      "name": "frontend",
      "isPrivate": false,
      "defaultBranch": "main",
      "language": "TypeScript",
      "connected": false,
      "repoId": null
    }
  ]
}
```

### Activating a repo

**Endpoint:** `POST /api/v1/repos`

**Request body:**

```json
{
  "fullName": "acme-corp/backend-api",
  "provider": "GITHUB",
  "defaultBranch": "main",
  "isPrivate": true,
  "language": "TypeScript"
}
```

**Handler logic:**

1. Check plan limits. If FREE and already at 1 repo, return 403 with `{ error: "Free plan limit reached. Upgrade to add more repositories." }`.
2. Check for duplicates (`organizationId + provider + fullName` has a unique constraint).
3. Create the `Repository` record.
4. Register a GitHub webhook on the repo for `push` and `pull_request` events (using the installation token). Store the returned webhook ID on the repo record.
5. Enqueue an initial scan of the default branch: create a `Scan` record with `triggeredBy: MANUAL, status: QUEUED`, and push a job to the Redis scan queue.
6. Return the created repo with scan status.

### Deactivating a repo

**Endpoint:** `DELETE /api/v1/repos/:repoId`

**Handler logic:**

1. Delete the GitHub webhook using the stored `webhookId`.
2. Delete the `Repository` record (cascades to scans and findings).
3. Return 204.

Note: We might want to add a "soft disconnect" option later that stops webhooks but keeps the scan history. For v1, hard delete is fine since the data can always be regenerated by re-scanning.

---

## 5. First Scan Experience

### Trigger

When a repo is activated (step 3 of the wizard), the API immediately creates a scan job:

```
Scan {
  repositoryId: repo.id,
  triggeredBy: MANUAL,
  branch: repo.defaultBranch,
  commitSha: <fetched from GitHub API: latest commit on default branch>,
  status: QUEUED
}
```

The job is pushed to the Redis `scan:queue` list. The worker (`packages/worker/`) picks it up.

### Worker pipeline

1. Clone the repo (shallow, single branch) into a temp directory.
2. Run semgrep with our rule set.
3. Run AI detectors (hallucination, auth validation, logic bug) on changed/flagged files.
4. Write findings to the database.
5. Compute risk score and update the repo and scan records.
6. Push a `scan:complete` event to Redis pub/sub (for future WebSocket support).

### Progress tracking

The frontend polls for scan status. The scan record has `status`, `startedAt`, `completedAt`, and `durationMs` fields that give the frontend everything it needs to show progress.

For v1, the UI shows three states:
- **Queued** -- "Waiting to start..." with a spinner.
- **Running** -- "Analyzing your code..." with a progress bar (indeterminate, since we do not know percentage).
- **Complete** -- "Found X issues" with a link to results.
- **Failed** -- "Scan failed" with a retry button and the error reason.

### Empty state

If the scan completes with zero findings, show a celebration state: "No issues found! Your code looks clean." with a green checkmark. This is a good moment -- make it feel like a win, not like something is broken.

---

## 6. Billing Integration

### Tiers

| Feature | Free | Pro ($29/mo) | Enterprise (custom) |
|---|---|---|---|
| Repositories | 1 | Unlimited | Unlimited |
| Analysis | Static (semgrep) only | Static + AI pipeline | Static + AI + custom rules |
| Team members | 1 | 10 | Unlimited |
| Scan history | 7 days | 90 days | 1 year |
| Support | Community | Email | Dedicated |

### Stripe integration

We already have the Stripe fields on `Organization`: `stripeCustomerId`, `stripeSubscriptionId`, `stripeSubscriptionStatus`.

**Upgrade flow:**

1. User clicks "Upgrade" in the dashboard (shown when hitting free tier limits or via the settings page).
2. Frontend calls `POST /api/v1/billing/checkout` which creates a Stripe Checkout session with the `STRIPE_TEAM_PRICE_ID` and returns the session URL.
3. User completes payment on Stripe's hosted checkout page.
4. Stripe fires `checkout.session.completed` webhook to `POST /webhooks/stripe`.
5. Our handler updates the org: `plan = TEAM`, `stripeCustomerId`, `stripeSubscriptionId`, `stripeSubscriptionStatus = "active"`, `planUpdatedAt = now()`.
6. Stripe redirects user back to `/dashboard?upgraded=true`. The dashboard shows a brief "Welcome to Pro!" toast.

**Subscription lifecycle webhooks:**

- `customer.subscription.updated` -- sync status changes (e.g., past_due, canceled).
- `customer.subscription.deleted` -- downgrade org to FREE plan. Do not delete repos or data, but disable AI detectors on future scans and stop processing webhooks for repos beyond the free limit.

**Upgrade prompts (where they appear):**

- Repo activation when at the free limit.
- Findings list: AI-specific findings show a "Pro" badge with "Upgrade to see AI analysis" on hover.
- Settings page: plan comparison table with upgrade button.
- After a scan completes: if AI detectors were skipped due to free plan, show a banner: "AI analysis available on Pro. Upgrade to catch hallucinations, auth bugs, and logic errors."

### Downgrade behavior

When a subscription is canceled or expires:

1. Set `plan = FREE`.
2. Do not delete any data.
3. On next scan, skip AI detectors (semgrep-only).
4. If the org has more than 1 repo, only process webhooks for the oldest (first-connected) repo. Show a notice on the others: "Paused -- upgrade to resume scanning."

---

## 7. Team Management

### Inviting team members

**Endpoint:** `POST /api/v1/orgs/:orgId/invitations`

**Request body:**

```json
{
  "email": "alice@acme.com",
  "role": "MEMBER"
}
```

**Handler logic:**

1. Check seat limits. FREE plan: 1 seat. TEAM plan: 10 seats. Count existing users in the org.
2. Call the Clerk API to create an invitation: `POST https://api.clerk.com/v1/invitations` with `{ email_address, redirect_url: "https://app.thecodesheriff.com/sign-up", public_metadata: { organizationId, role } }`.
3. Clerk sends the invitation email.
4. Return 201.

### When the invited user signs up

1. Clerk fires `user.created` webhook.
2. Our handler checks `public_metadata` on the Clerk user for `organizationId` and `role`.
3. If present, the user gets added to the existing org instead of creating a new one.
4. If not present (direct signup, not via invitation), a new org is created as usual.

**Schema change needed:** The `handleUserCreated` function in `clerk.ts` needs to be updated to check for invitation metadata. Currently it always creates a new organization.

### Role management

**Endpoint:** `PATCH /api/v1/orgs/:orgId/members/:userId`

**Request body:**

```json
{
  "role": "ADMIN"
}
```

**Authorization:** Only `OWNER` can change roles. Only one `OWNER` per org. Transferring ownership requires setting the new owner and demoting the old one in a transaction.

### Removing team members

**Endpoint:** `DELETE /api/v1/orgs/:orgId/members/:userId`

**Authorization:** `OWNER` or `ADMIN` can remove members. `OWNER` cannot be removed (must transfer ownership first).

**Handler logic:**

1. Delete the `User` record from the DB.
2. Optionally revoke the user's Clerk session (call `POST https://api.clerk.com/v1/users/:clerkId/revoke`).

---

## 8. Error Handling and Resilience

### What if the Clerk webhook fails?

The webhook handler already has a self-healing fallback: if `user.updated` fires for a user that does not exist in the DB, it provisions them as if `user.created` had fired.

For an additional layer of resilience, add a **just-in-time provisioning middleware** to the auth layer:

1. The auth middleware (`packages/api/src/middleware/auth.ts`) already verifies the Clerk JWT and extracts the `clerkId`.
2. After JWT verification, query the DB for the user by `clerkId`.
3. If not found, call the Clerk API to fetch the user's profile, then run the same provisioning logic from the webhook handler.
4. Attach the user to the request and continue.

This means even if webhooks fail completely, users never see a broken dashboard. The first API call with a valid JWT triggers provisioning.

**Implementation note:** This needs a distributed lock (Redis `SET NX` with TTL) to avoid race conditions if multiple API calls arrive simultaneously for the same unprovisioned user.

### What if the GitHub installation webhook fails?

If we miss the `installation.created` webhook:

1. The user will have been redirected back to our app with `installation_id` in the query params.
2. The frontend calls `POST /api/v1/orgs/:orgId/github/link` with the installation ID from the URL.
3. The API links the installation manually, same as the webhook would have done.

So the frontend redirect acts as a reliable backup for the webhook. The webhook is still useful for cases where the installation happens outside our flow (e.g., directly from GitHub Marketplace).

Add a "Reconnect GitHub" button in the org settings that re-triggers the GitHub App install flow. This handles the case where everything went wrong and the user needs to start over.

### What if the first scan fails?

Show a clear error with context:

- **Clone failed:** "Could not access your repository. Make sure the CodeSheriff GitHub App has access to this repo." with a link to GitHub App settings.
- **Analysis timeout:** "The scan took too long. This can happen with very large repositories. Try again or contact support."
- **Internal error:** "Something went wrong on our end. We have been notified. Click retry to try again."

Always show a "Retry" button. The retry creates a new `Scan` record (do not reuse the failed one).

### What if the user's session expires during onboarding?

Clerk handles session refresh automatically via its frontend SDK. If the session truly expires (user was away for hours), Clerk redirects to sign-in. After signing in again, the user should land back on the onboarding wizard at whatever step they left off.

**Implementation:** Store the current onboarding step in the Organization record (new field: `onboardingStep` enum or nullable int). The dashboard checks this on load and resumes the wizard if not complete.

### Webhook delivery guarantees

Both Clerk (via Svix) and GitHub retry failed webhook deliveries. Our handlers must be idempotent:

- `user.created`: Check if user exists before creating. Already implemented.
- `installation.created`: Check if `githubInstallationId` is already set. Skip if so.
- Scan triggers: Use the unique constraint on `(repositoryId, commitSha, triggeredBy)` to avoid duplicate scans. (This constraint needs to be added.)

---

## 9. Database Schema Changes

### New fields on Organization

```prisma
model Organization {
  // ... existing fields ...

  /// Tracks onboarding wizard progress. Null = onboarding complete.
  onboardingStep Int?
}
```

Values:
- `1` = needs to name org
- `2` = needs to install GitHub App
- `3` = needs to select repos
- `4` = waiting for first scan
- `null` = onboarding complete

### New model: Invitation

```prisma
model Invitation {
  id String @id @default(cuid())

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  email String
  role  UserRole @default(MEMBER)

  /// Clerk invitation ID for tracking status
  clerkInvitationId String? @unique

  status InvitationStatus @default(PENDING)

  invitedBy   String
  invitedAt   DateTime @default(now())
  acceptedAt  DateTime?
  expiresAt   DateTime

  @@index([organizationId])
  @@index([email])
}

enum InvitationStatus {
  PENDING
  ACCEPTED
  EXPIRED
  REVOKED
}
```

### New unique constraint on Scan

Add a unique constraint to prevent duplicate scans for the same commit:

```prisma
model Scan {
  // ... existing fields ...

  @@unique([repositoryId, commitSha, triggeredBy])
}
```

### Add Organization relation for Invitation

```prisma
model Organization {
  // ... existing relations ...
  invitations Invitation[]
}
```

---

## 10. API Endpoint Specs

### Onboarding endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/dashboard/me` | Clerk JWT | Returns current user + org + onboarding state |
| PATCH | `/api/v1/orgs/:orgId` | Clerk JWT, OWNER | Update org name/slug |
| POST | `/api/v1/orgs/:orgId/github/link` | Clerk JWT, OWNER/ADMIN | Link GitHub App installation to org |
| GET | `/api/v1/orgs/:orgId/github/repos` | Clerk JWT | List repos from GitHub installation |
| POST | `/api/v1/repos` | Clerk JWT, OWNER/ADMIN | Activate a repo (creates record + triggers scan) |
| DELETE | `/api/v1/repos/:repoId` | Clerk JWT, OWNER/ADMIN | Deactivate a repo |

### Billing endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/billing/checkout` | Clerk JWT, OWNER | Create Stripe Checkout session, return URL |
| GET | `/api/v1/billing/portal` | Clerk JWT, OWNER | Create Stripe Customer Portal session, return URL |
| POST | `/webhooks/stripe` | Stripe signature | Handle subscription lifecycle events |

### Team management endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/orgs/:orgId/members` | Clerk JWT | List org members |
| POST | `/api/v1/orgs/:orgId/invitations` | Clerk JWT, OWNER/ADMIN | Invite a new member |
| DELETE | `/api/v1/orgs/:orgId/invitations/:id` | Clerk JWT, OWNER/ADMIN | Revoke a pending invitation |
| PATCH | `/api/v1/orgs/:orgId/members/:userId` | Clerk JWT, OWNER | Change a member's role |
| DELETE | `/api/v1/orgs/:orgId/members/:userId` | Clerk JWT, OWNER/ADMIN | Remove a member |

### Webhook endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/webhooks/clerk` | Svix signature | User lifecycle events |
| POST | `/webhooks/github` | GitHub HMAC | Push, PR, installation events |
| POST | `/webhooks/stripe` | Stripe signature | Subscription lifecycle events |

---

## UI Mockup Descriptions

### Onboarding wizard layout

The wizard is a centered card (max-width 640px) on a clean background. A progress bar at the top shows steps 1-5 with the current step highlighted. Each step transitions with a subtle slide animation.

The card has:
- A step title at the top (e.g., "Name your organization")
- The step content in the middle
- Navigation at the bottom: "Back" (left) and "Continue" (right)
- "Skip for now" link below the card (only on optional steps)

### Dashboard empty state

When the user has no repos connected yet, the dashboard shows a single centered card:

> **Get started with CodeSheriff**
>
> Connect a GitHub repository to start finding security issues in your code.
>
> [Connect GitHub] button
>
> Or, if you have already installed the GitHub App: [Select repositories] link

### Upgrade prompt modal

When the user hits a free tier limit, a modal appears:

> **Unlock the full power of CodeSheriff**
>
> Your free plan includes 1 repository and static analysis.
> Upgrade to Pro to get:
> - Unlimited repositories
> - AI-powered analysis (hallucination detection, auth validation, logic bugs)
> - 90-day scan history
> - Team collaboration (up to 10 members)
>
> **$29/month**
>
> [Upgrade to Pro] button
> [Maybe later] link

### Scan progress card (onboarding step 4)

A vertical list of repo cards, each showing:

```
[repo-icon]  acme-corp/backend-api
             [=====>        ] Analyzing... 23 files scanned
```

Or when complete:

```
[repo-icon]  acme-corp/backend-api
             [==============] Complete -- 12 issues found
             [View Results]
```

---

## Implementation Priority

1. **Just-in-time user provisioning middleware** -- highest impact, prevents the "broken dashboard" bug for any edge case.
2. **Onboarding wizard (steps 1-3)** -- gets users connected to GitHub.
3. **First scan trigger on repo activation** -- makes the product immediately useful.
4. **Billing checkout flow** -- enables revenue.
5. **Team invitations** -- needed for multi-user orgs.
6. **Tooltip tour on first dashboard visit** -- nice polish, lower priority.
