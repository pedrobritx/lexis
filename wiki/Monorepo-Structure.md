# Monorepo Structure

Lexis is a pnpm workspace monorepo. All code lives in one repository under `apps/` and `packages/`.

---

## Directory layout

```
lexis/
├── apps/
│   ├── api/          Fastify REST API (Node.js + TypeScript)
│   ├── realtime/     Socket.IO realtime server (Node.js + TypeScript)
│   ├── web/          Next.js 14 web frontend
│   └── ios/          Swift + SwiftUI (iPad-first)
├── packages/
│   ├── db/           Prisma client + middleware
│   ├── types/        Shared TypeScript DTOs and enums
│   ├── cache/        Redis client wrapper (ioredis)
│   ├── logger/       pino structured logger factory
│   ├── events/       Event bus (EventEmitter wrapper)
│   └── ai-prompts/   Versioned AI prompt builders
├── docs/             Specification docs (source of truth)
├── agents/           Domain build agents
├── scaffold/         Ready-to-use config files
├── .github/
│   └── workflows/    ci.yml + deploy-prod.yml
└── pnpm-workspace.yaml
```

---

## Apps

### `apps/api`
The core REST API. Fastify + TypeScript. Handles all CRUD, auth, billing, AI generation, and event emission. Deployed to Railway. See [[Architecture-Overview]] for service topology.

**Key files:**
```
apps/api/src/
├── server.ts           Fastify app factory
├── plugins/            cors, helmet, rate-limit, swagger
├── hooks/              authenticate Fastify hook
└── modules/
    ├── auth/
    ├── billing/
    ├── courses/
    ├── activities/
    ├── enrollments/
    ├── progress/
    ├── srs/
    ├── gamification/
    ├── ai-generator/
    ├── media/
    └── analytics/
```

### `apps/realtime`
The Socket.IO server. A separate Railway process. Communicates with `apps/api` only via Redis pub/sub — never imports API modules directly. See [[Realtime-Architecture]].

**Key files:**
```
apps/realtime/src/
├── server.ts           Socket.IO server factory
├── middleware/         JWT auth middleware
├── handlers/           Event handlers by type
└── jobs/               BullMQ flush + cron jobs
```

### `apps/web`
Next.js 14 frontend. Deployed to Vercel. App Router, TypeScript, design tokens. Serves both teacher dashboard and student lesson UI.

### `apps/ios`
Swift + SwiftUI. iPad-first, iPhone supported. Uses the generated Swift client from `pnpm generate:clients`. Tokens stored in Keychain. Online-only (no offline mode).

---

## Packages

### `packages/db`
**Owns the Prisma client.** No other package or app creates a `PrismaClient` instance. Exports:
- `prisma` — the singleton client with middleware applied
- `softDelete(model, id)` — sets `deleted_at = now()` safely
- Tenant isolation middleware
- Soft-delete filter middleware

See [[Prisma-Middleware]].

### `packages/types`
Single source of truth for all TypeScript DTOs and enums shared across API, web, and iOS (via OpenAPI codegen). Whenever you add a new API response shape, add its type here first.

### `packages/cache`
Thin ioredis wrapper for Upstash Redis. Exports a `redis` singleton. Handles connection string parsing, Upstash TLS, and reconnection.

### `packages/logger`
pino structured logger factory. Usage:
```typescript
import { createLogger } from '@lexis/logger'
const logger = createLogger('api')
logger.info({ tenantId, path }, 'Request received')
```
Never use `console.log` in production code.

### `packages/events`
Internal event bus (Node.js `EventEmitter` wrapper). Used for decoupled module communication within the API process. Key events: `lesson.completed`, `activity.correct`, `srs.reviewed`.

### `packages/ai-prompts`
Versioned TypeScript prompt builders. One file per capability (e.g., `generate-lesson.v1.ts`). Exports `buildPrompt(params)` returning `{system, user}` strings. See [[AI-Prompt-Architecture]].

---

## Dependency rules

| From | Can import | Cannot import |
|---|---|---|
| `apps/*` | `packages/*` | Other `apps/*` |
| `packages/*` | Other `packages/*` (except `db`) | `apps/*` |
| `packages/db` | — | Any other package |

These rules are enforced by TypeScript path aliases and ESLint. Violations will fail CI.

---

## Adding a new package

1. Create `packages/my-package/`
2. Add `package.json` with `"name": "@lexis/my-package"`
3. Add to `pnpm-workspace.yaml` if not already using glob
4. Run `pnpm install` from root
5. Import with `import { ... } from '@lexis/my-package'`

---

## pnpm workspace commands

```bash
# Run a command in a specific workspace
pnpm --filter api dev
pnpm --filter @lexis/db build

# Run a command in all workspaces
pnpm -r build

# Add a dependency to a specific workspace
pnpm --filter api add fastify
pnpm --filter @lexis/db add -D prisma
```
