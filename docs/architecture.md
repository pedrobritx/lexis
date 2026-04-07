# Architecture

## Monorepo structure

```
lexis/
├── apps/
│   ├── api/          Fastify REST API (Node.js + TypeScript)
│   ├── realtime/     Socket.IO realtime server (Node.js + TypeScript)
│   ├── web/          Next.js 14 frontend
│   └── ios/          Swift + SwiftUI (iPad-first)
├── packages/
│   ├── db/           Prisma client + middleware (tenant isolation, soft-delete)
│   ├── types/        Shared TypeScript DTOs and enums
│   ├── cache/        Redis client wrapper (ioredis + Upstash)
│   ├── logger/       pino structured logger factory
│   ├── events/       Event bus (EventEmitter wrapper)
│   └── ai-prompts/   Versioned AI prompt builders
├── .github/
│   └── workflows/    ci.yml + deploy-prod.yml
├── .claude/
│   └── CLAUDE.md     Master context (you are here)
├── docs/             All specification docs
├── agents/           Domain build agents
└── scaffold/         Ready-to-use config files
```

## Service topology

```
Browser / iOS
    │
    ├── HTTPS ──► Vercel (apps/web) ──► api.lexis.app (REST)
    │                                       │
    └── WSS ───► rt.lexis.app (Socket.IO)   │
                     │                       │
                     └── Redis pub/sub ──────┘
                              │
                         Upstash Redis
                              │
                    ┌─────────┴─────────┐
               PostgreSQL           Cloudflare R2
              (Supabase)           (media + strokes)
```

The API server and the RT server **never call each other directly**. They communicate exclusively via Redis pub/sub channels. This is the critical architectural constraint.

## Package dependency rules

- `apps/*` can import from `packages/*`
- `packages/*` cannot import from `apps/*`
- `packages/db` owns the Prisma client — no other package creates a PrismaClient instance
- `packages/types` is the single source of truth for all DTOs — used by API, web, and iOS (via OpenAPI codegen)

## Key conventions

### API response shape
```typescript
// Success
{ data: T, meta?: { page, total } }

// Error
{ error: { code: string, message: string, details?: unknown } }
```

### Error codes (standardised)
```
auth/invalid_token         auth/expired_token        auth/missing_token
auth/invalid_otp           billing/limit_reached     billing/insufficient_credits
resource/not_found         resource/already_exists   resource/soft_deleted
permission/tenant_mismatch permission/role_required  rt/lock_rejected
```

### Route naming
```
POST   /v1/auth/magic/request
POST   /v1/auth/magic/verify
POST   /v1/auth/passkey/register/begin
POST   /v1/auth/passkey/register/complete
POST   /v1/auth/passkey/login/begin
POST   /v1/auth/passkey/login/complete
POST   /v1/auth/refresh
POST   /v1/auth/logout
DELETE /v1/users/me
GET    /v1/users/me
GET    /v1/courses
POST   /v1/courses
PATCH  /v1/courses/:id
DELETE /v1/courses/:id       (soft-delete)
GET    /v1/templates
POST   /v1/templates/:id/clone
GET    /v1/health             (no auth required)
```

## Environment variable groups

Three environments: `local`, `staging`, `production`.
See `scaffold/.env.example` for all variables.
See `docs/devops.md` for where each variable is stored.

## Prisma middleware (mandatory, do not remove)

Two middleware layers in `packages/db/src/middleware/`:

1. **Tenant isolation** — appends `WHERE tenant_id = ctx.tenantId` to all find/update/delete operations on mutable tables. Bypassed only for: `users`, `passkey_credentials`, `consent_records`, and courses with `visibility = 'public_template'`.

2. **Soft-delete filter** — appends `WHERE deleted_at IS NULL` to all find operations on Course, Unit, Lesson, Activity, User. The `softDelete(model, id)` helper sets `deleted_at = now()` — never call `prisma.course.delete()` directly.

Both middleware layers must be tested at 90% coverage. See `docs/testing.md`.

## OpenAPI + native clients

The API generates an OpenAPI spec at `GET /openapi.json`. Native clients are generated from this spec:
- Swift client: `openapi-generator-cli swift5` → `apps/ios/Sources/LexisAPI/`
- Kotlin client: `openapi-generator-cli kotlin` → (Phase 2, Android)

Run `pnpm generate:clients` after any API route change.
