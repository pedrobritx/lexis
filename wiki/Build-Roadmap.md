# Build Roadmap

Build in strict phase order. Each phase must be complete before the next begins. Do not skip days.

---

## Phase 1 — Core platform (30 days)

### Week 1 — Foundation

| Day | Goal | Deliverable |
|---|---|---|
| 1 | Monorepo setup + CI | pnpm workspace, ESLint, Prettier, husky, GitHub Actions CI |
| 2 | Schema + Prisma + seed | All tables migrated, `prisma studio` shows seed data |
| 3 | API skeleton + packages | Fastify server, all `packages/*`, Swagger at `/docs` |
| 4 | Auth module | Passkey + OTP flows, both auth paths work end-to-end |
| 5 | Users + consent + billing limits | GDPR delete works, `checkSubscriptionLimit()` tested |

### Week 2 — Backend core

| Day | Goal | Deliverable |
|---|---|---|
| 6 | Placement test | CEFR question bank, scoring algorithm, all endpoints |
| 7 | Courses module | Course/Unit/Lesson CRUD, template clone |
| 8 | Activities module | All 6 types, answer validation, near-match cloze |
| 9 | Enrollments + sessions | Classrooms, enrollment with billing check, session participants |
| 10 | Progress + XP + event bus | Auto-complete, `lesson.completed` event, XP award |

### Week 3 — Lesson engine + SRS

| Day | Goal | Deliverable |
|---|---|---|
| 11 | Lesson delivery API | Activity list, attempt endpoint, progress calculation |
| 12 | SRS module | SM-2 in `packages/srs`, stale content detection, streak logic |
| 13 | Gamification foundations | Badge catalogue seeded, evaluator registry, event bus listeners |
| 14 | Minimal AI endpoint | `activity` capability only (cloze/MCQ), SSE stream, credit check |
| 15 | E2E tests + staging deploy | OpenAPI spec exported, Swift client compiles, staging URL live |

### Weeks 4–5 — Web frontend

| Day | Goal | Deliverable |
|---|---|---|
| 16 | Web setup + auth pages | Next.js 14, passkey button + OTP entry, JWT session |
| 17 | Teacher dashboard | Stat cards, student roster, classrooms, activity feed |
| 18 | Course builder | List view, unit/lesson/activity editor, template browser |
| 19 | Lesson view (student) | Activity player: cloze, MCQ, matching, ordering, feedback |
| 20 | SRS review UI | Flashcard + mini-lesson, quality rating, review summary |
| 21–25 | iOS (Swift/SwiftUI) | Auth, dashboard, lesson view, SRS review, Keychain tokens |
| 26–27 | Placement test UI + onboarding | Welcome → profile → placement → result → first lesson |
| 28 | First real student pilot | Test on staging, verify 402 upgrade prompt, collect feedback |
| 29–30 | Bug fixes + production deploy | P0/P1 fixes, production migration, smoke test, tag `v0.1.0` |

---

## Phase 2 — Whiteboard + Assessments + Media (23 days)

### Week 1 — RT server (Days 1–5)
- `apps/realtime` scaffold: Socket.IO + Redis pub/sub
- JWT middleware, `board:join` → `board:state` flow
- `stroke:delta` → Redis buffer → R2 flush (60s cron)
- `object:create/update/delete` with PostgreSQL persistence
- Cursor, presence, follow mode, laser pointer
- Load test: 20 concurrent boards, p99 broadcast < 100ms

### Week 2 — Canvas UI (Days 6–10)
- Infinite canvas (pan/zoom via CSS transforms)
- 5-layer stack (pattern / stroke canvas / object layer / overlay / HUD)
- Drawing tools: pen (Catmull-Rom), highlighter, eraser
- Shapes + connectors with anchor snapping
- Sticky notes, text boxes, board patterns
- Activity cards as canvas objects (collapsed ↔ expanded)
- Session drawer + async mode (homework)

### Week 3 — Media pipeline (Days 11–14)
- Image (Sharp → WebP), PDF (thumbnail), audio (FFmpeg → WebM/Opus + waveform)
- Video embed (oEmbed), in-app recording (MediaRecorder)
- Storage limit check, signed R2 URL delivery
- Media library UI + activity media picker

### Week 4 — Assessments + iOS (Days 15–19)
- Open writing: rubric builder + grading interface
- Ordering: partial scoring
- Listening: audio prompt + recording response
- iOS whiteboard: PencilKit + Socket.IO Swift client

### Week 5 — QA (Days 20–23)
- Full session walkthrough (teacher web + student iOS simultaneously)
- RT latency measurement, bug fixes
- Production deploy, tag `v0.2.0`

---

## Phase 3 — Real-time deep features (28 days)

### Week 1 — Lock + undo (Days 1–5)
- Lock acquisition, TTL, keepalive, auto-release, force-unlock
- `board_commands` table, shared undo/redo
- Stroke undo via `hidden_strokes` Redis set, 500-command cap
- Sequence numbers on all broadcasts, replay buffer

### Week 2 — Zoom overlay (Days 6–10)
- 5-layer z-stack with overlay at z:30, annotation canvas at z:40
- `overlay:open/close` sync across all clients
- PDF.js in overlay, `pdf:push_page` sync
- Activity card in overlay with annotation support
- Follow mode extends into overlay

### Week 3 — PDF annotations (Days 11–16)
- PDF-space coordinate system (0–1 normalised)
- Freehand strokes, text comments, highlights
- Annotation persistence (R2 flush every 60s)
- Export annotated PDF via `pdf-lib`

### Weeks 4–5 — iOS + QA (Days 17–28)
- iOS: lock badge, undo via ⌘Z, health indicator, PencilKit annotations
- 5 adversarial QA scenarios (simultaneous lock grabs, undo sequencing, crash recovery, 2-min disconnect, cross-platform PDF annotation)
- Production deploy, tag `v0.3.0`

---

## Phase 4 — AI + Analytics + Gamification (35 days)

### Week 1 — AI backend (Days 1–5)
- `modules/ai-generator` + `packages/ai-prompts/`
- 6 prompt files (versioned), SSE streaming for all capabilities
- Draft review UI: inline editing, approve/discard
- Auto-trigger + on-demand next-lesson suggestions

### Week 2 — Analytics (Days 6–10)
- Error pattern nightly BullMQ job
- Student analytics APIs: progress, accuracy-weekly, SRS health
- Teacher analytics APIs: class heatmap, lesson effectiveness, teacher summary
- Disengagement flag, analytics caching (1hr Redis TTL)

### Week 3 — Gamification (Days 11–18)
- Full badge engine (all 12 badges), streak cron (timezone-aware), grace period
- Certificate issuance + public page (SSR + OG tags) + PDF generation
- Badge showcase + celebration animation
- Streak strip UI + disengagement flag UI

### Weeks 4–5 — iOS + QA (Days 19–35)
- iOS: AI generation panel, analytics charts (Swift Charts), gamification UI
- QA: AI across 5 CEFR levels, analytics vs seeded data, all 12 badge triggers, credit system
- Production deploy, tag `v0.4.0`

---

## Golden rule

> Each phase depends on the previous one being fully complete and tested. Do not start Phase 2 code until Phase 1 passes all integration tests and the staging pilot (Day 28) is complete.
