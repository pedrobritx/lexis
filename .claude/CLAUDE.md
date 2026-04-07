# Lexis — Claude Code Master Context

You are building **Lexis**, a language teaching platform. This is a production-grade SaaS product, not a prototype. Every decision in this codebase has been deliberately planned. Read the relevant doc files before writing any code.

---

## What Lexis is

A multi-tenant SaaS platform for language teachers. Teachers build courses, run whiteboard sessions with students, assign spaced-review homework, and use AI to generate lesson content. Students complete lessons, do daily SRS reviews, earn badges, and receive CEFR progress certificates.

**Current state:** pre-build. All planning is complete. No production code exists yet. You are starting from scratch with full specifications.

---

## How to navigate this context

All specification is in `/docs/`. All build agents are in `/agents/`. All scaffold files are in `/scaffold/`.

| File | Read when you are about to... |
|---|---|
| `docs/architecture.md` | Set up the monorepo, understand service topology |
| `docs/schema.md` | Write any Prisma query, create a migration, add an entity |
| `docs/auth.md` | Touch anything related to authentication or JWT |
| `docs/billing.md` | Touch subscriptions, limits, Stripe, feature gates |
| `docs/realtime.md` | Touch the RT server, Socket.IO, locks, undo/redo |
| `docs/phases.md` | Understand what to build in which order |
| `docs/testing.md` | Write or run any test |
| `docs/devops.md` | Deploy, configure environments, add secrets |
| `docs/ai.md` | Touch AI generation, prompts, drafts, credits |

---

## Non-negotiable rules

1. **Never hard-code tenant_id** — always read from `req.user.tenantId` extracted from the JWT.
2. **Never hard-delete** rows on Course, Unit, Lesson, Activity, User — always set `deleted_at = now()`.
3. **Never save AI output** to a course without teacher explicit approval — drafts only.
4. **Never skip the credit check** before an AI generation call.
5. **Never write `console.log`** in production code — use `pino` logger from `packages/logger`.
6. **Never commit secrets** — all secrets go in Railway/Vercel/GitHub environment variables.
7. **Split every large file** before hitting tool limits — save part 1, then continue.

---

## Tech stack at a glance

```
Monorepo:     pnpm workspaces
API:          Fastify + TypeScript (apps/api)
Realtime:     Socket.IO + Node.js (apps/realtime)
Web:          Next.js 14 + TypeScript (apps/web)
iOS:          Swift + SwiftUI (apps/ios)
Database:     PostgreSQL via Prisma ORM (packages/db)
Cache:        Redis via ioredis (packages/cache)
Storage:      Cloudflare R2 (S3-compatible)
Email:        Resend
Billing:      Stripe
AI:           Anthropic Claude (claude-sonnet-4-6)
Auth:         WebAuthn passkeys + OTP magic link
```

---

## Build order

Phase 1 → SaaS layer → Phase 2 → Phase 3 → Phase 4.
Within each phase, follow the day-by-day plan in `docs/phases.md`.
**Do not skip ahead.** Each phase depends on the previous one.

---

## Start here

If you are starting Phase 1 Day 1:
1. Read `docs/architecture.md` fully
2. Copy `scaffold/pnpm-workspace.yaml` and `scaffold/package.json` to project root
3. Run the domain agent for the module you are building (see `agents/`)
4. Check `docs/testing.md` before writing any test
