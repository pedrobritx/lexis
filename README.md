# Lexis

A multi-tenant SaaS platform for language teachers. Build courses, run live whiteboard sessions, assign spaced-review homework, and use AI to generate lesson content.

## Tech Stack

| Layer | Technology |
|---|---|
| API | Fastify + TypeScript |
| Realtime | Socket.IO + Redis pub/sub |
| Web | Next.js 14 |
| iOS | Swift + SwiftUI (iPad-first) |
| Database | PostgreSQL via Prisma ORM |
| Cache | Redis (Upstash) |
| Storage | Cloudflare R2 |
| Auth | WebAuthn passkeys + OTP magic links |
| AI | Anthropic Claude |
| Billing | Stripe |

## Monorepo Structure

```
lexis/
├── apps/
│   ├── api/            Fastify REST API
│   ├── realtime/       Socket.IO server
│   ├── web/            Next.js frontend
│   └── ios/            SwiftUI app
├── packages/
│   ├── db/             Prisma client + middleware
│   ├── types/          Shared TypeScript DTOs
│   ├── cache/          Redis client wrapper
│   ├── logger/         Pino structured logger
│   ├── events/         Typed event bus
│   └── ai-prompts/     Versioned AI prompt builders
├── docs/               Specifications
├── agents/             Domain build agents
└── scaffold/           Config templates
```

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker (for local Postgres + Redis)

### Setup

```bash
# Install dependencies
pnpm install

# Start local databases
pnpm docker:up

# Copy environment variables
cp .env.example .env
# Edit .env with your local values

# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate

# Start all services in dev mode
pnpm dev
```

### Services

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| Realtime | http://localhost:4000 |
| Web | http://localhost:3001 |

## Scripts

```bash
pnpm dev              # Start all services
pnpm build            # Build all packages + apps
pnpm typecheck        # Type-check everything
pnpm lint             # Lint everything
pnpm test             # Run all tests
pnpm test:unit        # Unit tests only
pnpm test:integration # Integration tests (needs Docker)
pnpm db:studio        # Open Prisma Studio
```

## Architecture

- **Multi-tenancy**: Shared-database with row-level `tenant_id` filtering via Prisma middleware
- **Auth**: Passwordless only — WebAuthn passkeys + OTP magic links, JWT access/refresh pair
- **AI**: All generated content goes through a mandatory teacher review flow (drafts only, never auto-saved to courses)
- **Realtime**: API and RT server communicate exclusively via Redis pub/sub — never direct calls

See [`docs/`](./docs/) for full specifications.

## Build Phases

| Phase | Scope | Duration |
|---|---|---|
| 1 | Core platform (auth, content, SRS, web, iOS) | 30 days |
| 2 | Whiteboard + media pipeline + assessments | 23 days |
| 3 | Real-time collaboration (locks, undo, overlays) | 28 days |
| 4 | AI generation + analytics + gamification | 35 days |

## License

Private — all rights reserved.
