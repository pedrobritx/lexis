# Observability

---

## Tools

| Tool | Purpose | Where |
|---|---|---|
| Better Uptime | Health checks every 3 min, public status page | `status.lexis.app` |
| Sentry | Error tracking + performance tracing | All 3 services |
| Railway Metrics | CPU, memory, request count per service | Railway dashboard |
| Axiom | Structured log aggregation | Railway log drain → Axiom |
| Cloudflare Analytics | R2 storage growth + CDN cache hit rate | Cloudflare dashboard |

---

## Structured logging

All services use `pino` from `packages/logger`. `console.log` is forbidden in production code.

### Required fields on every request log

```typescript
logger.info({
  timestamp: new Date().toISOString(),
  level: 'info',
  service: 'api',           // 'api' | 'realtime' | 'web'
  traceId: req.id,          // Fastify request ID
  tenantId: req.user?.tenantId,
  method: req.method,
  path: req.url,
  statusCode: reply.statusCode,
  durationMs: reply.elapsedTime
}, 'Request completed')
```

### Log levels

| Level | When to use |
|---|---|
| `error` | Unhandled exceptions, failed health checks |
| `warn` | Recoverable errors (retry succeeded, rate limit hit) |
| `info` | Request completed, job completed |
| `debug` | Local dev only — never in production |

---

## Sentry integration

Installed in all three services. Captures:
- Unhandled exceptions (automatic)
- Failed AI generation (manual capture with context)
- Slow database queries > 2s (performance tracing)

```typescript
import * as Sentry from '@sentry/node'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,  // 10% of requests
})

// Attach to Fastify
fastify.addHook('onError', (req, reply, error, done) => {
  Sentry.captureException(error, {
    extra: { tenantId: req.user?.tenantId, path: req.url }
  })
  done()
})
```

---

## Alert rules

### P0 — Email + SMS (wake you up at 3am)

| Trigger | Threshold |
|---|---|
| API server down | 2 consecutive failed health checks |
| RT server down | 2 consecutive failed health checks |
| Production DB unreachable | Any connection failure |
| Stripe webhook failing | 3 consecutive 5xx responses |
| New unhandled exception | Sentry first-occurrence alert |

### P1 — Email only (next business day)

| Trigger | Threshold |
|---|---|
| API p95 latency | > 2s for 5 consecutive minutes |
| RT server memory | > 80% of Railway memory limit |
| BullMQ job failures | > 3 failures in 1 hour |
| AI generation error rate | > 5% of requests |

---

## Health check endpoints

```
GET /v1/health      → { "status": "ok", "uptime": 12345 }
```

No authentication required. Used by:
- Railway health check (determines when rolling deploy is complete)
- Better Uptime (every 3 minutes)
- Smoke tests in `deploy-prod.yml`

The health check should verify:
1. Fastify is responding
2. Database connection is alive (`prisma.$queryRaw('SELECT 1')`)
3. Redis is alive (`redis.ping()`)

If any check fails, return 503.

---

## Axiom log drain

Railway streams all service logs to Axiom via the log drain feature. This provides:
- Full-text search across all services
- Retention beyond Railway's 7-day window (90-day retention in Axiom)
- Dashboards for error rates, latency percentiles, tenant-level usage

Set up: Railway → Service → Observability → Add log drain → Axiom HTTP endpoint.

---

## Cloudflare Analytics

Monitors:
- `media.lexis.app` CDN cache hit rate (target: > 80%)
- R2 storage growth per week (alerts at 90% of plan limit)
- `api.lexis.app` request volume trends
