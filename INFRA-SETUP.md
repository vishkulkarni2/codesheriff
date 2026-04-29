# Infrastructure Setup — CodeSheriff

**Generated: 2026-04-01**

---

## 1. Database: Neon Postgres (Free Tier)

**Time: 3 minutes**

1. Go to **https://console.neon.tech/signup**
2. Sign up with GitHub (vishkulkarni2)
3. Create a new project:
   - Name: `codesheriff-prod`
   - Region: `us-east-1` (closest to most users)
   - Postgres version: 16
4. Once created, copy the **Connection string** from the dashboard
   - It looks like: `postgresql://neondb_owner:abc123@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require`
5. Update `.env.production`:
   ```bash
   cd ~/.openclaw/workspace/codesheriff
   # Replace the DATABASE_URL line with your actual connection string
   ```
6. Run Prisma migrations:
   ```bash
   export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
   cd ~/.openclaw/workspace/codesheriff
   DATABASE_URL="<your-neon-url>" npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
   ```
7. (Optional) Seed the database:
   ```bash
   DATABASE_URL="<your-neon-url>" pnpm db:seed
   ```

---

## 2. Redis: Upstash (Free Tier)

**Time: 2 minutes**

1. Go to **https://console.upstash.com/login**
2. Sign up with GitHub (vishkulkarni2)
3. Create a new Redis database:
   - Name: `codesheriff-prod`
   - Region: `us-east-1`
   - TLS: Enabled
   - Eviction: Enabled
4. Copy the **Redis URL** from the dashboard
   - It looks like: `rediss://default:abc123@us1-xxx.upstash.io:6379`
   - Note: `rediss://` (with double s) means TLS
5. Update `.env.production`:
   ```bash
   # Replace REDIS_URL with your Upstash URL
   ```

---

## 3. Deployment Architecture

### Recommended setup:
- **Dashboard (Next.js)** → **Vercel** (free tier)
- **API (Fastify) + Worker (BullMQ)** → **Render** (free tier or $7/mo Starter)
- **Marketing site** → **Vercel** (already configured)

### Why Render for API + Worker:
- Supports background workers (BullMQ needs a long-running process)
- Free tier available (spins down after 15 min inactivity — OK for beta)
- Easy Docker deploy from GitHub repo
- Alternative: Railway ($5/mo, no spin-down)

### Vercel Dashboard Deployment:
```bash
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
cd ~/.openclaw/workspace/codesheriff

# Login to Vercel
vercel login

# Deploy the web app
cd apps/web
vercel --prod
```

### Render API + Worker Deployment:
1. Go to https://dashboard.render.com
2. Create a new **Web Service**:
   - Connect GitHub repo: vishkulkarni2/codesheriff
   - Root directory: (leave blank, uses Dockerfile)
   - Docker: use `docker/Dockerfile.api`
   - Add all env vars from .env.production
3. Create a new **Background Worker**:
   - Same repo
   - Docker: use `docker/Dockerfile.worker`
   - Same env vars

---

## 4. External Services Checklist

| Service | Status | Action Required |
|---|---|---|
| **Neon Postgres** | PENDING | Vish: Create account + DB (3 min) |
| **Upstash Redis** | PENDING | Vish: Create account + DB (2 min) |
| **GitHub App** | PENDING | Vish: See GITHUB-APP-SETUP.md (5 min) |
| **Clerk** | PENDING | Vish: Create production instance (5 min) |
| **Stripe** | PENDING | Vish: Create account, product, price (10 min) |
| **Resend** | PENDING | Vish: Create account, verify domain (5 min) |
| **Vercel** | PENDING | Vish: Login + deploy (5 min) |
| **Render** | PENDING | Vish: Create account + services (10 min) |
| **Anthropic** | HAVE KEY | Use existing or create production key |
| **Domain DNS** | DONE | app.thecodesheriff.com + api.thecodesheriff.com live |

---

## 5. Clerk Production Setup

1. Go to https://dashboard.clerk.com
2. Create a new **Production** instance (or switch existing from Dev to Production)
3. Enable **GitHub OAuth** as a social connection
4. Go to **API Keys** → copy:
   - Publishable key → `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - Secret key → `CLERK_SECRET_KEY`
5. Go to **Webhooks** → Add endpoint:
   - URL: `https://api.thecodesheriff.com/webhooks/clerk`
   - Events: `user.created`, `user.updated`, `user.deleted`
   - Copy signing secret → `CLERK_WEBHOOK_SECRET`

---

## 6. Stripe Setup

1. Go to https://dashboard.stripe.com
2. Get API keys:
   - Secret key → `STRIPE_SECRET_KEY`
3. Create Product:
   - Name: "CodeSheriff Team"
   - Price: $29/month, recurring
   - Copy price ID → `STRIPE_TEAM_PRICE_ID`
4. Create Webhook endpoint:
   - URL: `https://api.thecodesheriff.com/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy signing secret → `STRIPE_WEBHOOK_SECRET`
5. (Optional) Create coupon:
   - Code: `EARLYSHERIFF`
   - 100% off for 3 months
