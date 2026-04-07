# DevOps

## Infrastructure stack

| Service | Vendor | Purpose |
|---|---|---|
| API + RT servers | Railway | Node.js processes, rolling deploys |
| Web frontend | Vercel | Next.js, automatic Git deploy |
| PostgreSQL | Supabase Pro | Managed DB, PITR, connection pooling |
| Redis | Upstash | Serverless Redis, built-in replication |
| Object storage | Cloudflare R2 | S3-compatible, zero egress fees |
| CDN + DNS | Cloudflare | lexis.app DNS, R2 media CDN |
| Email | Resend | OTP codes, notifications |

**No AWS.** Use `@aws-sdk/client-s3` pointed at R2 endpoint — same API, different endpoint URL.

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
Signed URLs for private access: 1-hour TTL via `getSignedUrl`.

## Environments

| | Local | Staging | Production |
|---|---|---|---|
| API | localhost:3000 | api.staging.lexis.app | api.lexis.app |
| RT | localhost:4000 | rt.staging.lexis.app | rt.lexis.app |
| Web | localhost:3001 | staging.lexis.app | lexis.app |
| DB | Docker 5432 | Supabase lexis-staging | Supabase lexis-prod |
| Redis | Docker 6379 | Upstash lexis-staging | Upstash lexis-prod |
| R2 | lexis-dev bucket | lexis-staging bucket | lexis-prod bucket |
| Stripe | — | sk_test_ keys | sk_live_ keys |

**Staging Anthropic key:** set a $10/month hard cap in the Anthropic console.

## Deployment workflows

### ci.yml (every push + every PR)
Stage 1 (30s): type-check + lint
Stage 2 (1min): unit tests + coverage gates
Stage 3 (3min): integration + RT tests (Docker services)
Stage 4 (2min): deploy to staging (Railway CLI)
Stage 5 (2min): Playwright e2e on staging

PR cannot merge to main unless all 5 stages pass.

### deploy-prod.yml (merge to main only)
1. Verify ci.yml passed on this SHA
2. `prisma migrate deploy` on production DB (using DIRECT_URL)
3. Railway deploy API (rolling, health check at /health)
4. Railway deploy RT server (graceful 30s drain on SIGTERM)
5. Vercel deploys automatically via Git integration
6. Smoke test: curl /health on all 3 services
7. Git tag v{version}

**Migrations run before code deploys.** Every migration must be backwards-compatible with the currently-running code version.

## Secret storage

| Secret | Where stored |
|---|---|
| All Railway env vars | Railway dashboard (per environment) |
| Vercel env vars | Vercel dashboard (per environment) |
| CI secrets | GitHub Actions Secrets |
| Local secrets | `.env` (gitignored) copied from `.env.example` |

Never commit real secrets. `.env` is in `.gitignore`. `.env.example` has placeholder values only.

**Critical:** `DATABASE_URL` uses Supabase pooled connection (PgBouncer). `DIRECT_URL` bypasses PgBouncer for migrations only. Both required.

## DNS configuration

| Subdomain | Cloudflare proxied? | Notes |
|---|---|---|
| lexis.app | ✅ Yes | Vercel, CDN for static assets |
| api.lexis.app | ⚠️ Proxied, no cache | Dynamic API |
| rt.lexis.app | ❌ DNS-only | WebSockets require direct connection |
| media.lexis.app | ✅ Yes | R2 bucket, full CDN cache |

**WebSocket constraint:** `rt.lexis.app` must be DNS-only (grey cloud in Cloudflare). Cloudflare proxy breaks long-lived WebSocket connections on the free plan.

## Observability

| Tool | Purpose |
|---|---|
| Better Uptime | Health checks every 3min, status page at status.lexis.app |
| Sentry | Error tracking + performance, installed in api + realtime + web |
| Railway Metrics | CPU/memory per service (built-in) |
| Axiom | Structured log aggregation (Railway log drain) |
| Cloudflare Analytics | R2 storage growth + CDN cache hit rate |

**Structured logging:** all services use `pino` from `packages/logger`. Every request logs: `{timestamp, level, service, traceId, tenantId, method, path, statusCode, durationMs}`. No `console.log` in production.

## Alert rules

P0 (email + SMS):
- API or RT server down (2 consecutive failed health checks)
- Production DB unreachable
- Stripe webhook failing (3 consecutive 5xx)
- New unhandled exception in production (Sentry first occurrence)

P1 (email only):
- API p95 latency > 2s for 5 minutes
- RT server memory > 80% of limit
- >3 BullMQ job failures in 1 hour
- AI generation error rate > 5%

## Backups

**PostgreSQL (Supabase Pro):**
- Daily automated snapshots, 7-day retention
- Point-in-time recovery to any second within 7 days
- Weekly manual `pg_dump` uploaded to R2 at `backups/db/{date}.sql.gz`, 90-day retention
- RTO: < 30 minutes | RPO: < 1 second

**Cloudflare R2:**
- Object versioning enabled on production bucket, 30-day deleted object retention
- 11-nines durability SLA, global replication built-in

**Redis:** not backed up. All data reconstructible from PostgreSQL. Worst-case: users re-authenticate (refresh tokens lost), 60-second stroke gap (buffer not yet flushed).
