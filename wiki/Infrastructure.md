# Infrastructure

---

## Vendor stack

| Service | Vendor | Purpose |
|---|---|---|
| API + RT servers | Railway | Node.js processes, rolling deploys |
| Web frontend | Vercel | Next.js, automatic Git deploy |
| PostgreSQL | Supabase Pro | Managed DB, PITR, connection pooling |
| Redis | Upstash | Serverless Redis, built-in replication |
| Object storage | Cloudflare R2 | S3-compatible, zero egress fees |
| CDN + DNS | Cloudflare | `lexis.app` DNS, R2 media CDN |
| Email | Resend | OTP codes, upgrade notifications |

**No AWS.** The R2 client uses `@aws-sdk/client-s3` pointed at the R2 endpoint — same S3 API, different endpoint URL.

---

## Three environments

| | Local | Staging | Production |
|---|---|---|---|
| API | `localhost:3000` | `api.staging.lexis.app` | `api.lexis.app` |
| RT | `localhost:4000` | `rt.staging.lexis.app` | `rt.lexis.app` |
| Web | `localhost:3001` | `staging.lexis.app` | `lexis.app` |
| DB | Docker 5432 | Supabase `lexis-staging` | Supabase `lexis-prod` |
| Redis | Docker 6379 | Upstash `lexis-staging` | Upstash `lexis-prod` |
| R2 | `lexis-dev` bucket | `lexis-staging` bucket | `lexis-prod` bucket |
| Stripe | — | `sk_test_` keys | `sk_live_` keys |

**Staging Anthropic key:** set a $10/month hard cap in the Anthropic console to prevent runaway costs during testing.

---

## R2 configuration

```typescript
import { S3Client } from '@aws-sdk/client-s3'

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})
```

Public media URL: `https://media.lexis.app/{key}` (served via Cloudflare CDN).  
Private access: signed URLs via `getSignedUrl`, 1-hour TTL.

---

## DNS configuration

| Subdomain | Cloudflare proxied? | Notes |
|---|---|---|
| `lexis.app` | ✅ Yes (orange cloud) | Vercel, CDN for static assets |
| `api.lexis.app` | ⚠️ Proxied, no cache | Dynamic API — proxied but cache disabled |
| `rt.lexis.app` | ❌ DNS-only (grey cloud) | **WebSockets require direct connection** |
| `media.lexis.app` | ✅ Yes (orange cloud) | R2 bucket, full CDN cache |
| `status.lexis.app` | ✅ Yes | Better Uptime status page |

### Why `rt.lexis.app` must be DNS-only

Cloudflare's proxy breaks long-lived WebSocket connections on non-Enterprise plans — connections are dropped after 100 seconds. Setting the RT subdomain to DNS-only (grey cloud) routes WebSocket traffic directly to Railway.

---

## Railway configuration

Both API and RT services use `railway.toml`:

```toml
# apps/api/railway.toml
[deploy]
startCommand = "node dist/server.js"
healthcheckPath = "/v1/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"

# apps/realtime/railway.toml
[deploy]
startCommand = "node dist/server.js"
shutdownDelay = 30   # Gives SIGTERM handler 30s for graceful drain
```

Rolling deploys: Railway starts the new instance, waits for health check, then drains and stops the old one.

---

## Supabase database connection

Two connection strings are required:

```
DATABASE_URL=postgresql://user:pass@pooler.supabase.com:6543/postgres
  → PgBouncer connection pool — used by the API at runtime

DIRECT_URL=postgresql://user:pass@db.supabase.com:5432/postgres
  → Direct connection — used by Prisma migrate only
```

Set both in Railway environment variables. Never use `DIRECT_URL` for regular queries (bypasses pooling).
