# Environment Variables

All variables and where they are stored. Never commit real values — use `.env.example` for placeholder documentation.

---

## How to set up locally

```bash
cp scaffold/.env.example .env
# Edit .env with your local values
```

`.env` is gitignored. Never commit it.

---

## API (`apps/api`)

Stored in: Railway dashboard → `api` service → Variables

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@pooler.supabase.com:6543/postgres` | PgBouncer pooled — runtime |
| `DIRECT_URL` | `postgresql://user:pass@db.supabase.com:5432/postgres` | Direct — migrations only |
| `REDIS_URL` | `rediss://user:pass@upstash.io:6380` | Upstash connection string |
| `JWT_SECRET` | `a-long-random-string` | Minimum 32 chars |
| `JWT_REFRESH_SECRET` | `another-long-random-string` | Can be same as JWT_SECRET |
| `WEBAUTHN_RP_ID` | `lexis.app` | Must match the domain |
| `WEBAUTHN_RP_ORIGIN` | `https://lexis.app` | Full origin including scheme |
| `STRIPE_SECRET_KEY` | `sk_live_xxx` | `sk_test_xxx` on staging |
| `STRIPE_WEBHOOK_SECRET` | `whsec_xxx` | From Stripe webhook dashboard |
| `RESEND_API_KEY` | `re_xxx` | From Resend dashboard |
| `ANTHROPIC_API_KEY` | `sk-ant-xxx` | From Anthropic console |
| `R2_ACCOUNT_ID` | `abc123` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | `xxx` | R2 API token key ID |
| `R2_SECRET_ACCESS_KEY` | `xxx` | R2 API token secret |
| `R2_BUCKET` | `lexis-prod` | Bucket name |
| `PORT` | `3000` | Default 3000 |
| `NODE_ENV` | `production` | `development` locally |
| `LOG_LEVEL` | `info` | pino log level |

---

## Realtime server (`apps/realtime`)

Stored in: Railway dashboard → `realtime` service → Variables

| Variable | Notes |
|---|---|
| `REDIS_URL` | Same Upstash instance as API |
| `DATABASE_URL` | Same Supabase pooled connection |
| `JWT_SECRET` | Must match API's secret exactly |
| `PORT` | `4000` |
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `R2_ACCOUNT_ID` | Same R2 credentials as API (for stroke flush) |
| `R2_ACCESS_KEY_ID` | |
| `R2_SECRET_ACCESS_KEY` | |
| `R2_BUCKET` | |

---

## Web frontend (`apps/web`)

Stored in: Vercel dashboard → Project → Environment Variables

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.lexis.app` |
| `NEXT_PUBLIC_RT_URL` | `https://rt.lexis.app` |
| `NEXT_PUBLIC_WEBAUTHN_RP_ID` | `lexis.app` |
| `NEXTAUTH_SECRET` | For Next.js session (if used) |

---

## CI/CD (GitHub Actions)

Stored in: GitHub repository → Settings → Secrets and variables → Actions

| Secret | Used in |
|---|---|
| `RAILWAY_TOKEN` | Stage 4 deploy, deploy-prod.yml |
| `SUPABASE_DIRECT_URL` | deploy-prod.yml migration step |
| `PLAYWRIGHT_BASE_URL` | `https://staging.lexis.app` |
| `STAGING_API_KEY` | For seeding test users in E2E |

---

## Local dev minimums

For a working local environment, you only need:

```bash
# .env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lexis
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/lexis
REDIS_URL=redis://localhost:6379
JWT_SECRET=local-dev-secret-change-in-production
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_ORIGIN=http://localhost:3001
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug

# Optional for local (mocked if not set):
# RESEND_API_KEY=re_xxx       → OTP codes printed to logs if missing
# ANTHROPIC_API_KEY=sk-ant-  → AI generation requires this
# STRIPE_SECRET_KEY=sk_test_ → Billing webhooks require this
```

---

## Staging-specific notes

- **Stripe:** use `sk_test_` keys and test webhook signing secrets
- **Anthropic:** set a $10/month spend cap in the Anthropic console for the staging key
- **Resend:** staging can share the same API key but emails are sent to real addresses — use a test email domain or Resend's test mode
- **R2:** use the `lexis-staging` bucket — separate from prod to avoid polluting production storage
