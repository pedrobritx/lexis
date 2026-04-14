# Getting Started

Local development setup for the Lexis monorepo.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 LTS | Use `nvm` or `fnm` |
| pnpm | 9+ | `npm install -g pnpm` |
| Docker | 24+ | For Postgres + Redis |
| Docker Compose | v2 | Included with Docker Desktop |

---

## 1. Clone the repo

```bash
git clone https://github.com/your-org/lexis.git
cd lexis
```

---

## 2. Install dependencies

```bash
pnpm install
```

This installs dependencies for all workspaces: `apps/api`, `apps/realtime`, `apps/web`, and all `packages/*`.

---

## 3. Set up environment variables

```bash
cp scaffold/.env.example .env
```

Edit `.env` and fill in the required values. See [[Environment-Variables]] for the full reference. For local dev you only need:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lexis
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/lexis
REDIS_URL=redis://localhost:6379
JWT_SECRET=any-random-string-for-local
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_ORIGIN=http://localhost:3001
```

---

## 4. Start infrastructure

```bash
docker compose up -d
```

This starts:
- PostgreSQL on port `5432`
- Redis on port `6379`

Verify both are healthy:
```bash
docker compose ps
```

---

## 5. Run database migrations + seed

```bash
pnpm db:migrate
pnpm db:seed
```

The seed creates:
- System tenant + system user
- CEFR A1–C1 public templates
- Pedro (teacher account), 2 test students

Verify with Prisma Studio:
```bash
pnpm db:studio
```

---

## 6. Start all services

In separate terminals (or use a process manager):

```bash
# Terminal 1 — REST API (port 3000)
pnpm --filter api dev

# Terminal 2 — Realtime server (port 4000)
pnpm --filter realtime dev

# Terminal 3 — Web frontend (port 3001)
pnpm --filter web dev
```

Or start everything at once:
```bash
pnpm dev
```

---

## 7. Verify

| Check | URL |
|---|---|
| API health | `http://localhost:3000/v1/health` |
| Swagger docs | `http://localhost:3000/docs` |
| Web app | `http://localhost:3001` |
| Prisma Studio | Opened by `pnpm db:studio` |

---

## First-run checklist

- [ ] `docker compose ps` shows all services healthy
- [ ] `GET /v1/health` returns `{"status":"ok"}`
- [ ] Prisma Studio shows all tables with seed data
- [ ] Web app loads login page at `localhost:3001`
- [ ] OTP flow works: request code → check terminal log (Resend is mocked locally) → verify code → JWT issued

---

## Useful commands

```bash
pnpm test              # Run all tests
pnpm test:unit         # Vitest unit tests only
pnpm test:integration  # Supertest + Docker test DB
pnpm lint              # ESLint across all packages
pnpm typecheck         # TypeScript check across all packages
pnpm db:migrate        # Apply pending migrations
pnpm db:seed           # Re-run seed (idempotent)
pnpm generate:clients  # Regenerate Swift/Kotlin clients from OpenAPI
```

---

## Next steps

- [[Monorepo-Structure]] — understand what each workspace does
- [[Contributing]] — PR workflow and non-negotiable rules
- [[Architecture-Overview]] — how the services connect
