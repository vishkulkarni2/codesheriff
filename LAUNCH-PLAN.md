# CodeSheriff Launch Plan
**Prepared:** 2026-04-01 | **Target:** Trial launch by 2026-04-30 | **Author:** COO/CMO Audit

---

## Part 1: Product Audit — Current State

### What's Built (Working)

| Component | Status | Notes |
|---|---|---|
| **Monorepo structure** | Done | pnpm + Turborepo, clean separation |
| **Prisma schema + migrations** | Done | 10 models, 2 migrations applied |
| **Fastify API server** | Done | 8 route groups, 4 webhook handlers, Clerk auth, rate limiting, CORS, Helmet |
| **BullMQ worker** | Done | Scan processor with graceful shutdown, weekly digest job |
| **Analysis pipeline** | Done | 8-stage pipeline: AIPattern, Secrets, Static, Hallucination, Auth, Logic, Explanation, Scorer |
| **AI detectors** | Done | 3 Claude-powered detectors + explanation engine, plan-gated |
| **AIPatternDetector** | Done | 6 regex heuristic rules, oversized function detection |
| **Semgrep rules** | Done | 7 custom AI-specific YAML rules |
| **GitHub webhook handler** | Done | HMAC verification, PR + push events, idempotent job enqueue |
| **GitLab webhook handler** | Done | MR + push support with encrypted token storage |
| **Clerk user provisioning** | Done | Webhook for user.created/updated/deleted |
| **Stripe billing** | Done | Checkout, Customer Portal, webhook plan sync, FREE -> TEAM upgrade |
| **Next.js dashboard** | Done | Dashboard, repos, repo detail, scans, scan detail, rules, settings, onboarding |
| **Marketing site** | Done | Landing page, pricing, docs, about, blog, legal pages, dark theme, animated demo |
| **CI/CD pipeline** | Done | GitHub Actions: typecheck, lint, test, Docker build+push to GHCR |
| **Docker Compose** | Done | Postgres 15 + Redis 7, optional pgAdmin + Redis Commander |
| **Autotune package** | Done | Self-improving evolution loop for semgrep rules + Claude prompts |
| **README + .env.example** | Done | Comprehensive, 50+ env vars documented |
| **Dockerfiles** | Done | API, worker, web — all three service images |
| **Slack notifications** | Done | Post-scan webhook notifications |
| **Email digests** | Done | Weekly digest via Resend |
| **Risk history** | Done | Daily snapshots, trend charts |

### What's NOT Done (Gaps)

#### P0 — Must Have for Trial Launch

| Gap | Description | Effort | Owner |
|---|---|---|---|
| **GitHub App not created** | No GitHub App exists at github.com/apps/codesheriff-dev. Without this, zero users can connect repos. | 1 hour | Vish |
| **Clerk webhook not registered** | POST /webhooks/clerk not registered in Clerk Dashboard. Users can sign up via Clerk but org/user records won't be provisioned in CodeSheriff DB. | 30 min | Vish |
| **Stripe account not configured** | No Stripe keys, no price IDs, no webhook endpoint registered. Billing won't work. | 1 hour | Vish |
| **No production database** | No hosted Postgres. Need Neon, Supabase, Railway, or Render Postgres. | 1 hour | Vish |
| **No production Redis** | No hosted Redis. Need Upstash, Railway, or Render Redis. | 30 min | Vish |
| **App not deployed** | API, worker, and web are not deployed anywhere. Need Render/Railway/Fly.io. | 3 hours | Rache |
| **E2E test never run** | The full flow (GitHub push -> webhook -> scan -> PR comment) has never been tested with real repos. | 3 hours | Rache + Vish |
| **No domain setup** | app.codesheriff.dev and api.codesheriff.dev not configured. Marketing site references these URLs. | 1 hour | Vish |
| **semgrep/TruffleHog not verified** | The static analyzer and secrets scanner shell out to semgrep and trufflehog binaries. Not confirmed these are installed in Docker images. | 1 hour | Rache |
| **Cal.com booking page** | Marketing site links to cal.com/codesheriff/demo but the page doesn't exist. | 30 min | Vish |

#### P1 — Should Have Before Trial

| Gap | Description | Effort | Owner |
|---|---|---|---|
| **Error monitoring** | No Sentry/Datadog. Production errors will be invisible. | 1 hour | Rache |
| **Logging infrastructure** | Pino logs go to stdout. Need a log drain (Datadog, Logtail, Axiom). | 1 hour | Rache |
| **Health check monitoring** | No uptime monitoring on /health endpoint. | 30 min | Vish |
| **Rate limit tuning** | Global 300/min may be too aggressive for webhook bursts. | 30 min | Rache |
| **Onboarding flow E2E test** | Sign-up -> install GitHub App -> first scan -> dashboard. Manual test needed. | 2 hours | Vish |
| **Autotune corpus** | Corpus directory exists but may be empty or minimal. Need labeled samples. | 3 hours | Rache |
| **Marketing site Vercel deploy** | Vercel project exists but need to verify it's live at codesheriff-marketing.vercel.app. | 30 min | Vish |
| **Privacy policy / Terms** | Pages exist on marketing site but need legal review for production use. | 2 hours | Vish |

#### P2 — Nice to Have (Post-Trial)

| Item | Description |
|---|---|
| GitLab App creation | GitLab integration code exists but no GitLab App created |
| SARIF export | Mentioned in plans but not verified if implemented |
| Custom rules editor UI | Rules page exists but editor may be read-only |
| Annual billing | Pricing page mentions $290/year but Stripe may only have monthly |
| Automated DB backups | Need pg_dump cron or managed DB with auto-backup |
| SSO/SAML | Enterprise feature, not needed for trial |
| Bitbucket support | Worker has stub for Bitbucket, not implemented |

### Can a Real User Use This Today?

**No.** The code is ~90% complete but 0% deployed. A user cannot:
1. Sign up (Clerk works, but no webhook to provision DB records)
2. Connect a GitHub repo (no GitHub App exists)
3. Trigger a scan (no deployed API/worker, no production DB/Redis)
4. See results (no deployed web app)

The code quality is high. The architecture is solid. But the "last mile" deployment and external service configuration hasn't been done.

### Test Assessment

- 7 test files exist across analyzer and API packages
- Tests cover: pipeline, subprocess safety, hash functions, LLM detectors, AI pattern detection, severity scoring, API routes
- CI pipeline runs tests with Postgres + Redis service containers
- **Tests have not been verified to pass locally on the Mac Mini** (no node_modules installed, no DB running)

---

## Part 2: Go-To-Market Plan

### Positioning

**Tagline:** "The security scanner that gets smarter from your codebase."

**One-liner for devs:** "CodeSheriff catches what Snyk and Semgrep miss — hallucinated APIs, auth flow bugs, and logic errors introduced by AI coding assistants. And it learns from your feedback."

### Competitive Differentiation

| Feature | Snyk | Semgrep | SonarQube | **CodeSheriff** |
|---|---|---|---|---|
| Static analysis | Yes | Yes | Yes | Yes (semgrep) |
| Secrets scanning | Yes | No | No | Yes (TruffleHog) |
| AI-specific detectors | No | No | No | **Yes** |
| Hallucination detection | No | No | No | **Yes (Claude)** |
| Auth flow validation | No | No | No | **Yes (Claude)** |
| Self-improving rules | No | No | No | **Yes (autotune)** |
| PR inline comments | Yes | Yes | Yes | Yes |
| Free tier | Limited | Yes | Community | Yes |
| Learns from feedback | No | No | No | **Yes** |

**Key message:** "Other tools scan for known vulnerability patterns. CodeSheriff understands your code semantically — and gets smarter every time you mark a false positive."

### Target Beta Users (10-20)

1. **Individual developers** using Cursor/Copilot/Claude heavily who want a safety net
2. **Tech leads at startups** (5-30 engineers) who adopted AI coding tools and worry about quality
3. **Open-source maintainers** who receive AI-generated PRs and want automated review
4. **Security-conscious developers** who use Snyk/Semgrep but want AI-specific detection

### Where to Find Them

| Channel | Tactic | Timeline |
|---|---|---|
| **Hacker News** | Show HN post with live demo + autotune explanation | Week 3-4 |
| **Twitter/X** | Thread showing real findings in AI-generated code. Tag @cursor_ai, @github, @anthropic | Week 2-4 |
| **Reddit** | r/programming, r/webdev, r/devops — "I built a scanner that catches AI hallucinations" | Week 3 |
| **LinkedIn** | Vish's network — direct messages to engineering leaders | Week 2-3 |
| **GitHub** | README badges, topics, discussions. Sponsor open-source repos with free scans. | Week 2 |
| **Dev.to / Hashnode** | Blog post: "5 security bugs AI coding assistants introduce (and how to catch them)" | Week 2 |
| **Discord / Slack communities** | Cursor, Claude, Copilot communities | Week 2-3 |
| **Direct outreach** | 50 targeted emails to developers who tweet about AI coding + security | Week 2-3 |

### Beta Signup Flow

1. User visits codesheriff.dev (marketing site)
2. Clicks "Get started free" -> redirected to app.codesheriff.dev/sign-up
3. Signs up via Clerk (GitHub OAuth preferred for frictionless GitHub App install)
4. Onboarding wizard: Install GitHub App -> select repos -> first scan triggers automatically
5. Dashboard shows results within 2-3 minutes
6. Upgrade to Team for AI detectors (14-day free trial, no credit card)

### Pricing Strategy for Beta

- **Free tier: $0 forever** — 1 repo, 20 files/scan, semgrep + secrets only
- **Team tier: $29/month** — unlimited repos, 50 files/scan, all AI detectors, Slack, SARIF
- **Beta special:** First 20 Team users get 3 months free (code: EARLYSHERIFF)
- **Enterprise:** Not launched yet. "Contact us" placeholder.

### Feedback Collection

1. **In-app feedback widget** — thumbs up/down on each finding (feeds autotune)
2. **False positive button** — one-click marking, data used for autotune evolution
3. **Monthly 15-min call** with each beta user (Vish does these)
4. **Feedback form** — link in weekly digest email
5. **GitHub Discussions** — public feedback channel on the codesheriff repo
6. **Slack community** — invite-only for beta users

### Content Plan

| Week | Content | Channel |
|---|---|---|
| 1 | "What is CodeSheriff?" blog post | codesheriff.dev/blog, Dev.to |
| 2 | "5 Security Bugs AI Assistants Introduce" | Blog + Twitter thread |
| 2 | Demo video: 2-min setup to first scan | YouTube, Twitter, LinkedIn |
| 3 | "How autotune works" technical deep dive | Blog + HN |
| 3 | Show HN post | Hacker News |
| 4 | "Why we built CodeSheriff" founder story | LinkedIn + Blog |
| 4 | Weekly "Bug of the Week" series starts | Twitter |

---

## Part 3: 4-Week Launch Roadmap

### Week 1 (Apr 1-7): Infrastructure & External Services

**Goal:** All external services configured, app deployed, basic E2E working.

| Task | Priority | Owner | Est. |
|---|---|---|---|
| Create GitHub App at github.com/settings/apps/new | P0 | Vish | 1h |
| Set up Clerk production instance + webhook endpoint | P0 | Vish | 1h |
| Set up Stripe account + test keys + TEAM price + webhook | P0 | Vish | 1h |
| Provision production Postgres (Neon free tier) | P0 | Vish | 30m |
| Provision production Redis (Upstash free tier) | P0 | Vish | 30m |
| Create cal.com/codesheriff/demo booking page | P0 | Vish | 30m |
| Verify semgrep + TruffleHog in Docker images | P0 | Rache | 1h |
| Deploy API + Worker to Render/Railway | P0 | Rache | 3h |
| Deploy Web to Vercel | P0 | Rache | 1h |
| Configure DNS: app.codesheriff.dev, api.codesheriff.dev | P0 | Vish | 1h |
| Run Prisma migrations on production DB | P0 | Rache | 30m |
| Verify marketing site is live on Vercel | P1 | Vish | 30m |
| **Milestone:** API health check returns 200 on api.codesheriff.dev/health | | | |

### Week 2 (Apr 8-14): E2E Testing & Bug Fixes

**Goal:** Complete flow works. Sign up -> connect repo -> scan -> see results.

| Task | Priority | Owner | Est. |
|---|---|---|---|
| E2E test: ngrok + real repo + GitHub App install -> full scan | P0 | Rache + Vish | 4h |
| Fix any bugs found during E2E | P0 | Rache | 4h |
| Test Clerk signup -> webhook -> DB user provisioning | P0 | Vish | 1h |
| Test Stripe checkout -> plan upgrade -> AI detectors enabled | P0 | Vish | 1h |
| Test onboarding wizard flow end-to-end | P0 | Vish | 1h |
| Add Sentry error monitoring to API + Worker | P1 | Rache | 1h |
| Add log drain (Axiom/Logtail free tier) | P1 | Rache | 1h |
| Set up uptime monitoring (BetterUptime free tier) | P1 | Vish | 30m |
| Populate autotune corpus with 20+ labeled samples | P1 | Rache | 3h |
| Record 2-minute demo video | P1 | Vish | 2h |
| Write "What is CodeSheriff?" blog post | P1 | Vish | 2h |
| **Milestone:** Vish can sign up, connect a real repo, and see scan results | | | |

### Week 3 (Apr 15-21): Beta Invite & Content

**Goal:** First 5 beta users onboarded. Content pipeline running.

| Task | Priority | Owner | Est. |
|---|---|---|---|
| Create beta invite list (20 targets from Twitter, GitHub, LinkedIn) | P0 | Vish | 2h |
| Send first 10 beta invites (personal email/DM, not mass blast) | P0 | Vish | 2h |
| Monitor first beta user signups — be on standby for bugs | P0 | Rache | ongoing |
| Write "5 Security Bugs AI Assistants Introduce" blog post | P1 | Vish | 3h |
| Create Twitter thread from blog post | P1 | Vish | 1h |
| Publish demo video to YouTube | P1 | Vish | 1h |
| Write "How autotune works" technical post | P1 | Vish + Rache | 3h |
| Add in-app feedback widget (thumbs up/down on findings) | P1 | Rache | 3h |
| Create Stripe coupon: EARLYSHERIFF (3 months free Team) | P1 | Vish | 15m |
| Set up GitHub Discussions for feedback | P1 | Vish | 30m |
| **Milestone:** 5 beta users have completed at least 1 scan each | | | |

### Week 4 (Apr 22-30): Scale & Iterate

**Goal:** 10-20 beta users, HN launch, feedback incorporated.

| Task | Priority | Owner | Est. |
|---|---|---|---|
| Send remaining 10 beta invites | P0 | Vish | 1h |
| Show HN post | P0 | Vish | 2h |
| Post to r/programming, r/webdev | P1 | Vish | 1h |
| Post to Cursor/Claude Discord/Slack communities | P1 | Vish | 1h |
| Triage and fix top 3 user-reported bugs | P0 | Rache | 6h |
| Incorporate false positive feedback into autotune corpus | P1 | Rache | 2h |
| Run first autotune evolution cycle on production data | P1 | Rache | 2h |
| Write "Why we built CodeSheriff" founder story | P2 | Vish | 2h |
| Start "Bug of the Week" Twitter series | P2 | Vish | 1h |
| Schedule 15-min feedback calls with active beta users | P1 | Vish | 2h |
| **Milestone:** 10+ active beta users, NPS > 7, zero critical bugs | | | |

---

## Part 4: Go/No-Go Criteria for Trial Launch

### Go Criteria (ALL must be true by Apr 14)

- [ ] A new user can sign up at app.codesheriff.dev
- [ ] GitHub App install flow works (onboarding wizard)
- [ ] Pushing code to a connected repo triggers a scan automatically
- [ ] Scan results appear on dashboard within 5 minutes
- [ ] PR comments with findings are posted on GitHub
- [ ] Check Run appears on the PR with pass/fail status
- [ ] Stripe checkout works for FREE -> TEAM upgrade
- [ ] No data loss — scans, findings, and risk history are persisted
- [ ] Error monitoring is active (Sentry)
- [ ] API responds to /health with 200

### No-Go Conditions (any one blocks launch)

- [ ] Scans fail silently with no error visibility
- [ ] Webhook signature verification is broken (security risk)
- [ ] User data leaks between organizations (IDOR)
- [ ] API crashes under normal load (< 10 concurrent scans)
- [ ] Database migrations fail on production

---

## Part 5: Infrastructure Recommendations

| Service | Recommendation | Cost | Notes |
|---|---|---|---|
| **Database** | Neon Postgres (free tier: 0.5 GB) | $0 | Scale to Pro ($19/mo) when needed |
| **Redis** | Upstash Redis (free tier: 10K commands/day) | $0 | Scale to Pay-as-you-go when needed |
| **API + Worker hosting** | Render (free tier for starter) or Railway ($5/mo) | $5-10/mo | Need always-on for worker |
| **Web hosting** | Vercel (free tier) | $0 | Next.js native |
| **Marketing site** | Vercel (free tier) | $0 | Static export, already configured |
| **Error monitoring** | Sentry (free tier: 5K events/mo) | $0 | |
| **Logging** | Axiom (free tier: 500MB/mo) | $0 | |
| **Uptime monitoring** | BetterUptime (free tier) | $0 | |
| **Domain** | codesheriff.dev | ~$12/yr | Likely already owned |
| **Email** | Resend (free tier: 100 emails/day) | $0 | |
| **Anthropic API** | Pay-as-you-go | ~$5-20/mo at beta scale | 3 detectors per scan |

**Estimated monthly cost at beta scale: $10-30/month**

---

## Appendix: Quick Reference

### Key URLs (Post-Deploy)
- Marketing: https://codesheriff.dev (or codesheriff-marketing.vercel.app)
- App: https://app.codesheriff.dev
- API: https://api.codesheriff.dev
- Docs: https://codesheriff.dev/docs
- Demo booking: https://cal.com/codesheriff/demo

### Key Repos
- Main: https://github.com/vishkulkarni2/codesheriff
- Marketing: https://github.com/vishkulkarni2/codesheriff-marketing

### Key Commands
```bash
# Local dev
docker compose up -d && pnpm dev

# Run tests
pnpm test

# Database
pnpm db:generate && pnpm db:migrate && pnpm db:seed

# Autotune
pnpm autotune
```
