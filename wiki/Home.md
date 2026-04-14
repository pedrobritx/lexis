# Lexis

**Lexis** is a multi-tenant SaaS platform for language teachers. Teachers build courses, run interactive whiteboard sessions with students, assign spaced-review homework, and use AI to generate lesson content. Students complete lessons, do daily SRS reviews, earn badges, and receive CEFR progress certificates.

---

## Core loop

```
Teacher creates course
    ↓
Student enrolls → takes placement test → starts lessons
    ↓
Activities completed → XP awarded → SRS queue populated
    ↓
Daily SRS review → streak maintained → badges earned
    ↓
CEFR level reached → certificate issued
```

---

## Stack at a glance

| Layer | Technology |
|---|---|
| API | Fastify + TypeScript (Node.js) |
| Realtime | Socket.IO + Node.js |
| Web | Next.js 14 + TypeScript |
| iOS | Swift + SwiftUI (iPad-first) |
| Database | PostgreSQL via Prisma ORM (Supabase) |
| Cache | Redis via ioredis (Upstash) |
| Storage | Cloudflare R2 (S3-compatible) |
| Email | Resend |
| Billing | Stripe |
| AI | Anthropic Claude (claude-sonnet-4-6) |
| Auth | WebAuthn passkeys + OTP magic link |

---

## Current status

| Phase | Description | Status |
|---|---|---|
| Phase 1 | Core platform (30 days) | In progress |
| Phase 2 | Whiteboard + Media + Assessments | Planned |
| Phase 3 | RT deep features (locks, undo, annotations) | Planned |
| Phase 4 | AI + Analytics + Gamification | Planned |

See [[Build-Roadmap]] for the full day-by-day plan.

---

## Wiki index

### Getting Started
- [[Getting-Started]] — Local dev setup, first run
- [[Monorepo-Structure]] — Apps and packages explained
- [[Contributing]] — PR workflow, coding rules

### Architecture
- [[Architecture-Overview]] — Service topology, constraints
- [[API-Conventions]] — Response shapes, error codes, routes
- [[Database-Schema]] — All entities with column notes
- [[Redis-Key-Reference]] — Redis-only structures and TTLs
- [[Prisma-Middleware]] — Tenant isolation + soft-delete layers

### Auth & Billing
- [[Authentication]] — Passkeys, OTP, JWT, GDPR delete
- [[Billing-and-Plans]] — Tiers, limits, feature flags
- [[Stripe-Integration]] — Webhooks, upgrade flow, credit system

### Core Modules
- [[Courses-and-Content]] — Course/Unit/Lesson/Activity CRUD
- [[Enrollments-and-Sessions]] — Classrooms, sessions, participants
- [[Placement-Test]] — CEFR scoring algorithm
- [[Progress-and-XP]] — Attempts, auto-complete, XP
- [[SRS-Algorithm]] — SM-2, staleness, streaks

### Gamification & Analytics
- [[Badges-and-Gamification]] — Badge catalogue, event bus, awards
- [[Streaks]] — Timezone cron, grace period, disengagement
- [[Certificates]] — Issuance, public page, PDF generation
- [[Analytics]] — Error patterns, heatmaps, caching

### Real-time Whiteboard
- [[Realtime-Architecture]] — Separate process, Redis pub/sub
- [[Whiteboard-Events]] — Full Phase 2 + Phase 3 event contract
- [[Lock-and-Undo]] — Lock system, board_commands, undo/redo
- [[Stroke-Persistence]] — BullMQ flush, MessagePack, R2
- [[Sequence-Numbers-and-Reconnect]] — Replay buffer, reconnect flow

### Media & AI
- [[Media-Pipeline]] — Upload processing, R2, signed URLs
- [[AI-Generation]] — Capabilities, SSE streaming, draft review
- [[AI-Prompt-Architecture]] — Versioned prompts, buildPrompt contract
- [[Next-Lesson-Suggestions]] — Auto-trigger, on-demand, credit waiver

### Infrastructure & Operations
- [[Infrastructure]] — Vendors, environments, DNS
- [[CI-CD-Pipelines]] — ci.yml + deploy-prod.yml
- [[Environment-Variables]] — All env vars and where they live
- [[Observability]] — Sentry, Axiom, alerts, pino fields
- [[Backup-and-Recovery]] — RTO/RPO, PITR, R2 versioning

### Testing
- [[Testing-Strategy]] — Tiers, tools, Docker DB, coverage gates
- [[Critical-Test-Cases]] — Must-exist tests per module
- [[E2E-Test-Journeys]] — 8 Playwright journeys, load targets

### Reference
- [[API-Reference]] — All endpoints with shapes + error codes
- [[Build-Agents]] — Domain agents and when to use them
- [[Build-Roadmap]] — Phase-by-phase day plan
