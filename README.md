# CodeSheriff

AI-powered code security scanning that catches what AI coding assistants introduce: hallucinated APIs, hardcoded secrets, IDOR vulnerabilities, auth flow bugs, and logic errors — automatically reviewed on every pull request.

---

## How it works

1. Connect your GitHub or GitLab repo
2. CodeSheriff installs a webhook and runs on every PR and push
3. The analysis pipeline runs semgrep, TruffleHog, and Claude-powered detectors
4. Results appear as inline PR comments, a GitHub Check Run, and a risk score dashboard
5. High-severity findings block merges until resolved

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 App Router, Tailwind CSS, Recharts |
| API | Fastify, Clerk JWT auth, BullMQ |
| Worker | BullMQ consumer, Prisma ORM |
| Analyzer | semgrep, TruffleHog, Anthropic Claude |
| Database | PostgreSQL 15 |
| Queue | Redis 7 |
| Auth | Clerk |
| Notifications | Slack webhooks, Resend (email) |

---

## Monorepo structure

```
apps/
  web/                    # Next.js frontend
packages/
  shared/                 # TypeScript types, enums, constants
  db/                     # Prisma schema + client
  analyzer/               # Analysis pipeline (semgrep + Claude detectors)
  api/                    # Fastify REST API + webhook handlers
  worker/                 # BullMQ scan processor + notifiers
docker/
  postgres/init.sql       # DB init
docker-compose.yml        # Local dev stack (Postgres + Redis)
```

---

## Local development

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker Desktop
- [Clerk](https://clerk.com) account (free)
- Anthropic API key
- GitHub App (for webhook integration)

### 1. Clone and install

```bash
git clone https://github.com/vishkulkarni2/codesheriff.git
cd codesheriff
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in values — see .env.example for required keys
```

### 3. Start infrastructure

```bash
docker compose up -d
# Optional dev tools (pgAdmin + Redis Commander):
docker compose --profile tools up -d
```

### 4. Set up the database

```bash
pnpm db:generate    # Generate Prisma client
pnpm db:migrate     # Run migrations
pnpm db:seed        # Seed with sample data
```

### 5. Run the dev servers

```bash
pnpm dev
```

This starts all packages in watch mode via Turborepo:
- Web: http://localhost:3000
- API: http://localhost:4000
- Worker: background process

---

## Analysis pipeline

Stages run in order on every scan:

| Stage | Detector | Plan |
|---|---|---|
| 1 | AIPatternDetector — regex + AST patterns for AI anti-patterns | All |
| 2 | SecretsScanner — TruffleHog for hardcoded credentials | All |
| 3 | StaticAnalyzer — semgrep with built-in + custom rules | All |
| 4 | HallucinationDetector — Claude: catches non-existent API calls | Team+ |
| 5 | AuthFlowValidator — Claude: auth/RBAC/session vulnerabilities | Team+ |
| 6 | LogicBugDetector — Claude: off-by-one, race conditions, type bugs | Team+ |
| 7 | ExplanationEngine — Claude: plain-English explanation + fix | Team+ |
| 8 | SeverityScorer — risk score 0–100 | All |

Stages 4–6 run concurrently. All stages are non-fatal — a detector failure never cancels the scan.

---

## Plans

| Feature | Free | Team | Enterprise |
|---|---|---|---|
| Static analysis (semgrep) | ✓ | ✓ | ✓ |
| Secrets scanning | ✓ | ✓ | ✓ |
| AI detectors (hallucination, auth, logic) | — | ✓ | ✓ |
| Files per scan | 20 | 50 | Custom |
| Custom semgrep rules | — | ✓ | ✓ |
| Slack notifications | — | ✓ | ✓ |
| SARIF export | — | ✓ | ✓ |
| SSO / SAML | — | — | ✓ |

---

## Repo configuration

Drop a `.codesheriff.yml` file at the root of any connected repo to tune PR
comment behavior per-repo — severity threshold for inline comments, noise caps,
summary length. Missing or malformed config falls back to safe defaults; scans
never fail because of config.

See [`packages/worker/CONFIG.md`](packages/worker/CONFIG.md) for the full schema
and examples.

---

## Environment variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `ANTHROPIC_API_KEY` | Claude API key for AI detectors |
| `CLERK_SECRET_KEY` | Clerk server-side secret |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | Webhook HMAC secret |
| `TOKEN_ENCRYPTION_KEY` | AES-256 key for VCS token encryption |

---

## Running tests

```bash
pnpm test           # All packages
pnpm test:analyzer  # Analyzer unit tests only
pnpm test:api       # API tests only
```

---

## Contributing

This is a private repository. All contributors must be added to the GitHub org.

---

## License

Proprietary. All rights reserved.
