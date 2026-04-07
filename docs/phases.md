# Build Phases

Build in strict order. Phase 1 must be complete before Phase 2. Do not skip days.

---

## Phase 1 — Core platform (30 days)

### Week 1 — Foundation

**Day 1:** Monorepo setup + CI pipeline
- pnpm workspace, tsconfig, ESLint, Prettier, husky
- `.github/workflows/ci.yml` and `deploy-prod.yml`
- Deliverable: monorepo boots, CI runs on first push

**Day 2:** Full schema + Prisma + seed
- Write complete `schema.prisma` (all entities from `docs/schema.md`)
- Run single clean migration with `--create-only` then review SQL before applying
- Seed: system tenant, system user, CEFR templates as `public_template` courses
- Seed: Pedro (teacher), 2 test students
- Deliverable: `prisma studio` shows all tables, seed data present

**Day 3:** API skeleton + shared packages + middleware
- Fastify app with cors, helmet, rate-limit
- `packages/types` — all DTOs
- `packages/db` — Prisma client + tenant isolation middleware + soft-delete middleware
- `packages/cache` — Redis client (Upstash)
- `packages/logger` — pino factory
- Swagger at `/docs`
- Deliverable: server starts, middleware tested, Swagger accessible

**Day 4:** Auth module — passkeys + OTP
- `POST /v1/auth/passkey/register/begin` + `/complete`
- `POST /v1/auth/passkey/login/begin` + `/complete`
- `POST /v1/auth/magic/request` + `/verify`
- `POST /v1/auth/refresh` + `/logout`
- `authenticate` Fastify hook
- Auto-create tenant + subscription on teacher registration
- Unit tests at 90% coverage
- Deliverable: both auth paths work end-to-end

**Day 5:** Users + consent + billing limits
- `POST /v1/auth/consent`, `GET /v1/users/me`, `PATCH /v1/users/me`
- `DELETE /v1/users/me` (GDPR soft-delete + cascade)
- `checkSubscriptionLimit` helper in `packages/billing`
- Deliverable: consent recorded, GDPR delete works, limit helper tested

### Week 2 — Backend core

**Day 6:** Placement test
- Question bank with CEFR-tagged questions (2 MCQ + 1 cloze per level, A1–C1)
- Scoring: highest level where both MCQs correct + cloze non-empty
- `GET /v1/placement/test`, `POST /v1/placement/submit`, `POST /v1/placement/skip`, `GET /v1/placement/history`
- Retakeable (no unique constraint)

**Day 7:** Courses module
- Full CRUD for Course, Unit, Lesson — all tenant-scoped
- `POST /v1/courses` checks lesson_plan limit
- Soft-delete with active enrollment guard
- `GET /v1/templates` (public, no tenant scope)
- `POST /v1/templates/:id/clone` (deep clone + tenant_id)

**Day 8:** Activities module
- CRUD for Activity — all tenant-scoped
- Type registry: cloze, mcq, matching, ordering, open_writing, listening
- `POST /v1/activities/:id/validate` — answer validation per type
- Near-match Levenshtein ≤2 for cloze with `accept_near_match: true`
- Partial scoring for ordering
- `image_url` shortcut field (Phase 2 replaces with media_asset_id)

**Day 9:** Enrollments + sessions
- Classroom CRUD, enrollment create/delete
- `POST /v1/classrooms/:id/enroll` checks student limit
- Sessions: accept `studentId` OR `classroomId` (not both)
- Auto-populate `session_participants` on group session create

**Day 10:** Progress + XP + event bus
- Lesson progress, activity attempt logging
- Auto-complete lesson on all activities done
- Emit `lesson.completed` event
- XP award, progress summary endpoint

### Week 3 — Lesson engine + SRS

**Day 11:** Lesson delivery API
- `GET /v1/lessons/:id/activities` — ordered activity list
- `POST /v1/progress/activities/:id/attempt` — log attempt, return validation result
- Progress calculation per lesson

**Day 12:** SRS module (SM-2 algorithm)
- SM-2 implementation in `packages/srs`
- SRS queue endpoint, review logging
- Activity version staleness check: if `srs_items.activity_version < activities.version` → reset interval, set `content_changed: true`
- Streak logic (increment/decrement)
- Unit tests at 90% coverage

**Day 13:** Gamification foundations
- `badges` catalogue seeded (12 badges from `docs/schema.md`)
- Badge evaluator registry
- Event bus listeners: `lesson.completed`, `activity.correct`, `srs.reviewed`
- `student_badges` award flow

**Day 14:** Minimal AI activity endpoint (unblocks content creation for pilot)
- `POST /v1/ai/generate` — capability: `activity` only (cloze or MCQ)
- Anthropic SDK, SSE streaming
- `ai_drafts` storage
- Credit check (returns 402 on free tier)

**Day 15:** API e2e tests + OpenAPI + staging deploy
- Full integration test suite (Supertest)
- Export OpenAPI spec
- `openapi-generator-cli swift5` — verify Kotlin client also compiles
- Deploy API to Railway staging
- Run migrations against staging DB
- Deliverable: staging URL live, Playwright smoke test passes

### Weeks 4–5 — Web frontend

**Day 16:** Web setup + auth pages
- Next.js 14, design tokens from `docs/devops.md`
- Passwordless login: passkey button + OTP code entry
- Consent screen on first registration
- JWT session management, protected route middleware

**Day 17:** Teacher dashboard
- `/dashboard` — stat cards, student roster, upcoming sessions
- Tabbed Students / Classrooms / Courses panels
- Activity feed

**Day 18:** Course builder
- `/courses` — list view
- `/courses/:id` — unit/lesson/activity editor
- Inline activity creation for all types
- Soft-delete with confirmation dialog
- Template browser + clone

**Day 19:** Lesson view (student)
- `/lessons/:id` — activity player
- Cloze, MCQ, matching, ordering renderers
- Feedback states (correct / incorrect / hint)
- Progress bar, XP animation

**Day 20:** SRS review UI
- `/review` — flashcard + mini-lesson renderers
- Quality rating buttons (flashcard mode)
- Auto-graded mini-lesson with SM-2 scoring
- Review summary screen

**Day 21–25:** iOS (Swift/SwiftUI)
- Auth: `ASAuthorizationController` passkey + OTP fallback
- Swift OpenAPI client from generated spec
- Teacher dashboard, course viewer
- Student lesson view + SRS review
- Tokens stored in Keychain

**Day 26–27:** Placement test UI + onboarding
- Student onboarding: welcome → profile → placement test → result → first lesson

**Day 28:** First real student pilot (on staging)
- Student uses staging URL with seeded system template content
- Teacher tests enroll-4th-student (verify 402 upgrade prompt)
- Measure, collect feedback, document issues

**Day 29–30:** Bug fixes + production deploy
- Fix all P0/P1 bugs from Day 28
- `pnpm prisma migrate deploy` against production DB
- Railway production deploy via `deploy-prod.yml`
- Smoke test production URL
- Tag `v0.1.0`

---

## Phase 2 — Whiteboard + Assessments + Media (23 days)

### Week 1 — RT server (Days 1–5)
- `apps/realtime` scaffold (Socket.IO + Redis)
- JWT middleware on Socket.IO
- `board:join` → `board:state` flow
- `stroke:delta` → Redis buffer → S3 flush (60s cron)
- `object:create/update/delete` with PostgreSQL persistence
- `cursor:move` and `presence:update`
- Follow mode (`follow:start/viewport/end`)
- Laser pointer (`laser:move/end`)
- Load test: 20 concurrent boards, verify p99 broadcast < 100ms

### Week 2 — Canvas UI (Days 6–10)
- Infinite canvas (pan/zoom with CSS transforms)
- 5-layer stack: pattern / stroke canvas / object layer / overlay / HUD
- Drawing tools: pen (Catmull-Rom smoothing), highlighter, eraser
- Shapes + connectors with anchor snapping
- Sticky notes + text boxes
- Magnetic snap (8px threshold, snap guides)
- Object locking (position only, text still editable)
- Board patterns (blank/dotted/squared)
- Activity cards as canvas objects (collapsed ↔ expanded)
- PDF and image drop onto canvas
- Session drawer + async mode (homework access)

### Week 3 — Media pipeline (Days 11–14)
- `POST /v1/media/upload` — image (Sharp → WebP), PDF (thumbnail), audio (FFmpeg → WebM/Opus + waveform), video embed (oEmbed)
- In-app audio recording (MediaRecorder API)
- Storage limit check before accepting uploads
- Signed R2 URL delivery (`GET /v1/media/:id/url`, 1-hour TTL)
- Media library UI + activity media picker
- Full listening activity type (audio prompt + in-app recording response)

### Week 4 — Assessments + iOS (Days 15–19)
- Open writing with rubric builder + grading interface
- Ordering activity with partial scoring
- Listening assessment grading flow
- SRS delivery modes: flashcard UI + mini-lesson UI
- iOS whiteboard (PencilKit + Socket.IO Swift client)

### Week 5 — QA (Days 20–23)
- Full session walkthrough (teacher web + student iOS simultaneously)
- RT latency measurement (target < 100ms WiFi, < 300ms LTE)
- Bug fixes, production deploy, tag `v0.2.0`

---

## Phase 3 — Real-time deep features (28 days)

### Week 1 — Lock + undo (Days 1–5)
- Lock acquisition, TTL, keepalive, auto-release on disconnect
- Teacher force-unlock
- `board_commands` table — command log for all mutations
- Shared undo (`board:undo`) and redo (`board:redo`)
- Stroke undo via `hidden_strokes` Redis set
- Sequence numbers on all broadcasts
- Replay buffer (last 500 events, 5-min TTL)
- Reconnect with `lastSeq` → replay missing events
- Connection health indicator (ping/pong, latency badge)
- In-memory edit queue drained after reconnect
- Lock indicator UI + undo history panel

### Week 2 — Zoom overlay (Days 6–10)
- 5-layer z-stack with overlay content at z:30, annotation canvas at z:40
- `overlay:open/close` events — all clients sync
- PDF.js in overlay (paginate, `pdf:push_page`)
- Activity card in overlay (teacher can annotate student work)
- Follow mode extends into overlay
- iOS: PDFKit overlay + PencilKit annotation canvas

### Week 3 — PDF annotations (Days 11–16)
- PDF-space coordinate system (0–1 normalised, device-independent)
- Freehand annotation strokes (tagged per PDF object)
- Text comments (double-tap to anchor)
- Highlights (text selection → bounding box)
- Annotation persistence (R2 flush every 60s)
- PDF annotation export (`POST /v1/board/objects/:id/export-annotated` via pdf-lib)

### Weeks 4–5 — iOS + QA (Days 17–28)
- iOS: lock badge UI, undo via ⌘Z, health indicator, PencilKit annotations
- 5 adversarial QA scenarios (two users grab same object, undo sequencing, crash recovery, 2-min disconnect, cross-platform PDF annotation)
- Production deploy, tag `v0.3.0`

---

## Phase 4 — AI + Analytics + Gamification (35 days)

### Week 1 — AI backend (Days 1–5)
- `modules/ai-generator` + `packages/ai-prompts/`
- 6 versioned prompt files: full_lesson, activity, rubric, adapt_lesson, personalised_review, suggest_next
- SSE streaming endpoint `POST /v1/ai/generate`
- Draft storage + teacher review → approve/discard flow
- Auto-trigger + on-demand next-lesson suggestions
- Draft review UI with inline editing

### Week 2 — Analytics (Days 6–10)
- Error pattern computation (nightly BullMQ job, `error_patterns` table)
- Student analytics APIs: progress, accuracy-weekly, srs-health
- Teacher analytics APIs: class heatmap, lesson effectiveness, teacher summary
- Disengagement flag nightly job
- Analytics UI: student `/progress` page, teacher heatmap, lesson insights tab

### Week 3 — Gamification (Days 11–18)
- Badge engine: evaluator registry + event bus listeners
- Streak cron: timezone-aware midnight evaluation, grace period, milestones
- Certificate issuance (`POST /v1/certificates`)
- Public certificate page `lexis.app/cert/:publicId` (SSR, OG tags)
- PDF generation via Puppeteer + S3 cache
- Badge showcase + celebration animation
- Streak strip UI
- iOS: badge celebration + streak strip parity

### Weeks 4–5 — iOS + QA (Days 19–35)
- iOS AI generation panel, analytics charts (Swift Charts), gamification UI
- QA: AI output across 5 CEFR levels, analytics vs seeded data, all 12 badge triggers, credit system
- Production deploy, tag `v0.4.0`
