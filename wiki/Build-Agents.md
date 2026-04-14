# Build Agents

Domain-specific build agents live in `agents/`. Each agent contains the complete implementation specification for one domain. Always read the relevant agent before implementing a new module for the first time.

---

## How to use agents

Agents are Markdown files containing:
- The exact API contract to implement
- Data model requirements
- Business logic rules
- Test cases to write
- Edge cases to handle

When starting a new module, run the corresponding agent:

```
In Claude Code: read agents/AuthAgent.md before implementing apps/api/src/modules/auth/
```

---

## Agent index

### `agents/AuthAgent.md`
**Domain:** Authentication and JWT  
**Phase:** 1  
**Covers:** Passkey registration + login (WebAuthn), OTP magic link, JWT issuance and rotation, refresh token storage, reuse detection, tenant auto-creation on teacher registration, consent flow, GDPR account deletion, passkey management endpoints.

### `agents/BillingAgent.md`
**Domain:** Billing and subscriptions  
**Phase:** 2  
**Covers:** `checkSubscriptionLimit()` helper, plan tier enforcement, feature flag checks, Stripe webhook handler (idempotency, three event types), upgrade request flow, Customer Portal session, AI credit decrement, grace period on cancellation.

### `agents/ContentAgent.md`
**Domain:** Courses, units, lessons, activities  
**Phase:** 1  
**Covers:** Full CRUD hierarchy, soft-delete guard on active enrollments, template system with `public_template` visibility, deep-clone flow, activity type registry, answer validation (near-match, partial scoring), version tracking.

### `agents/SRSAgent.md`
**Domain:** Spaced repetition (SM-2 algorithm)  
**Phase:** 1  
**Covers:** SM-2 algorithm implementation in `packages/srs`, ease_factor bounds, stale content version detection with interval reset, streak increment/decrement logic, SRS queue endpoint, review endpoint, SRS item creation on `lesson.completed`.

### `agents/GamificationAgent.md`
**Domain:** Badges, XP, streaks, certificates  
**Phase:** 4  
**Covers:** 12-badge catalogue seeding, evaluator registry pattern, event bus listeners (`lesson.completed`, `activity.correct`, `srs.reviewed`), badge award flow, XP formula with streak multiplier, certificate issuance + public page + PDF generation, streak grace period, disengagement flag nightly job.

### `agents/AIGeneratorAgent.md`
**Domain:** AI content generation  
**Phase:** 4 (partial implementation in Phase 1)  
**Covers:** 6 generation capabilities, SSE streaming implementation, mandatory draft review flow (approve/discard), JSON enforcement + retry logic, `packages/ai-prompts/` architecture, next-lesson suggestion auto-trigger + on-demand, credit waiver logic, `ai_generation_logs` tracking.

### `agents/WhiteboardAgent.md`
**Domain:** Real-time collaborative whiteboard  
**Phase:** 2 + 3  
**Covers:** `apps/realtime` scaffold, JWT Socket.IO middleware, room model, full Phase 2 + Phase 3 event contract, lock system (acquisition, keepalive, auto-release, force-unlock), shared undo/redo via `board_commands`, stroke persistence (60s BullMQ flush, MessagePack, R2), sequence numbers + replay buffer, graceful shutdown.

### `agents/MediaAgent.md`
**Domain:** File uploads and media assets  
**Phase:** 2  
**Covers:** `POST /v1/media/upload` multiprocessing by type (Sharp for images, FFmpeg for audio, pdf2pic for PDFs, oEmbed for video), storage limit check, signed R2 URL delivery, in-app audio recording with MediaRecorder API, `media_assets` table.

### `agents/AnalyticsAgent.md`
**Domain:** Student and teacher analytics  
**Phase:** 4  
**Covers:** Error pattern nightly computation (BullMQ, `error_patterns` table), student analytics APIs (progress, accuracy-weekly, SRS health), teacher analytics APIs (class heatmap, lesson effectiveness, teacher summary), disengagement flag, Redis caching (1hr TTL), cold vs warm cache performance targets.

---

## Agent usage pattern

```bash
# Before implementing a new module:
1. Read the spec doc: docs/{domain}.md
2. Read the build agent: agents/{Domain}Agent.md
3. Implement the module following the agent spec
4. Run tests: pnpm test:unit && pnpm test:integration
```

Agents are not auto-executed by Claude Code — they are reference documents that you read and follow during implementation.
