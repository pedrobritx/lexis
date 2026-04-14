# Architecture Overview

---

## Service topology

```
Browser / iOS
    │
    ├── HTTPS ──► Vercel (apps/web) ──► api.lexis.app (REST, port 3000)
    │                                           │
    └── WSS ───► rt.lexis.app (Socket.IO, 4000) │
                       │                        │
                       └──── Redis pub/sub ──────┘
                                   │
                              Upstash Redis
                                   │
                      ┌────────────┴────────────┐
                 PostgreSQL                Cloudflare R2
                (Supabase)           (media, strokes, backups)
```

### Critical constraint

**The API server and the RT server never call each other directly.** They communicate exclusively via Redis pub/sub channels. This ensures both services can scale independently and neither becomes a synchronous dependency of the other.

---

## Domain breakdown

| Service | Repo path | Deploy target | Port |
|---|---|---|---|
| REST API | `apps/api` | Railway | 3000 |
| Realtime server | `apps/realtime` | Railway | 4000 |
| Web frontend | `apps/web` | Vercel | 3001 (local) |
| iOS app | `apps/ios` | App Store | — |

---

## Package layer

```
apps/* import from ↓

packages/
├── db/           Prisma client — only source of PrismaClient
├── types/        All shared DTOs and enums
├── cache/        Redis client (ioredis + Upstash)
├── logger/       pino structured logger factory
├── events/       Internal event bus (EventEmitter)
└── ai-prompts/   Versioned AI prompt builders
```

See [[Monorepo-Structure]] for the full breakdown.

---

## OpenAPI + native clients

The API exposes its spec at `GET /openapi.json`. Native clients are generated from this spec:

```bash
pnpm generate:clients
```

| Client | Generator | Output |
|---|---|---|
| Swift | `openapi-generator-cli swift5` | `apps/ios/Sources/LexisAPI/` |
| Kotlin | `openapi-generator-cli kotlin` | (Phase 2, Android) |

Run `pnpm generate:clients` after any API route change. CI enforces this check.

---

## Auth flow (web)

```
1. User visits lexis.app
2. Next.js checks for valid JWT cookie
3. If missing/expired → redirect to /login
4. /login → POST /v1/auth/magic/request OR passkey flow
5. JWT pair issued → stored in HttpOnly cookie
6. All subsequent API calls include Authorization: Bearer {accessToken}
7. On 401 → auto-refresh via POST /v1/auth/refresh
```

See [[Authentication]] for the complete auth reference.

---

## Event-driven communication (within API)

Within the API process, modules communicate via the `packages/events` event bus:

```
progress module emits  → lesson.completed
srs module listens     → queues SRS items
gamification listens   → evaluates badge triggers
analytics listens      → updates error patterns
ai-generator listens   → triggers next-lesson suggestion
```

This keeps modules decoupled without requiring direct imports.

---

## Three environments

| | Local | Staging | Production |
|---|---|---|---|
| API | `localhost:3000` | `api.staging.lexis.app` | `api.lexis.app` |
| RT | `localhost:4000` | `rt.staging.lexis.app` | `rt.lexis.app` |
| Web | `localhost:3001` | `staging.lexis.app` | `lexis.app` |

See [[Infrastructure]] for vendor details and [[CI-CD-Pipelines]] for deployment workflow.
