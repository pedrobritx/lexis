# Testing Strategy

## Philosophy

Three tiers:
- **Critical (90% coverage):** auth, billing, SRS algorithm, tenant middleware — bugs here mean money loss, data leakage, or broken learning loop
- **Important (70% coverage):** activity validators, gamification, analytics, AI prompts
- **Covered by higher layers:** UI components, simple CRUD routes

CI gate: all tests must pass before merge to main. No exceptions.

## Tools

| Tool | Role |
|---|---|
| Vitest | Unit tests + RT event tests (all packages) |
| Supertest | Integration tests (API routes + real DB) |
| Playwright | E2E tests (browser flows against staging) |
| socket.io-client | RT event sequence tests (in-process server) |
| Artillery | Load tests (weekly, not a CI gate) |
| Docker Compose | Isolated test DB (postgres:5433, redis:6380) |

## Running tests

```bash
pnpm test:unit          # Vitest unit tests
pnpm test:integration   # Supertest + Docker DB
pnpm test:realtime      # socket.io-client event tests
pnpm test:e2e           # Playwright against staging
pnpm test               # All of the above (CI order)
pnpm test:coverage      # Unit + integration with coverage report
```

## Vitest workspace config

Coverage thresholds enforced per module:
```typescript
// vitest.workspace.ts — critical modules at 90%, rest at 70%
'**/modules/auth/**':    { lines: 90, functions: 90 }
'**/modules/billing/**': { lines: 90, functions: 90 }
'**/modules/srs/**':     { lines: 90, functions: 90 }
'**/db/middleware/**':   { lines: 90, functions: 90 }
'**':                    { lines: 70, functions: 70 }
```

## Integration test setup

```typescript
// test/globalSetup.ts — runs once before all integration tests
// 1. docker compose -f docker-compose.test.yml up -d
// 2. prisma migrate deploy (against test DB on port 5433)
// 3. prisma db seed (system tenant + CEFR templates)

// Each test file:
// beforeEach: wrap in transaction
// afterEach:  rollback transaction (keep DB clean between tests)
```

**Test helpers (import from test/helpers/):**
- `createTestTenant()` — creates tenant + teacher + free subscription
- `createTestStudent(tenantId)` — creates student + enrolls
- `getAuthHeader(userId)` — issues JWT, returns {Authorization: 'Bearer ...'}

## Critical test cases (must exist)

### Auth
- OTP: valid code → JWT issued, invalid code → 401, expired code → 401
- JWT: tampered → 401, expired → 401, refresh rotation + reuse detection
- Tenant auto-created on teacher registration
- Cross-tenant access → only own tenant data returned

### Billing
- 4th student enrollment on free plan → 402
- 6th course creation on free plan → 402
- Pro plan → no limits enforced
- Stripe webhook idempotency (same event twice → no double processing)
- Credit decrement + zero credits → InsufficientCreditsError

### SRS (SM-2)
- 10-review sequence: feed [4,4,5,3,4,5,5,2,4,5] → assert each interval/ease_factor
- ease_factor floor (1.3) and ceiling (2.5)
- Stale content version → interval resets to 1, content_changed: true

### Tenant middleware
- `findMany` appends tenant_id filter
- `public_template` courses bypass tenant filter
- Missing tenant context → MissingTenantContextError
- Soft-deleted records excluded from findMany

## E2E journeys (Playwright)

8 critical journeys run against staging:
1. Teacher onboarding (OTP → profile → template clone → free limit UI)
2. Student lesson completion (placement → cloze → MCQ → complete → badge)
3. AI lesson generation (brief → stream → inline edit → approve to course)
4. Whiteboard session (create → sticky note → activity card → follow mode)
5. SRS review (flashcard + mini-lesson → streak increment)
6. Certificate (issue → public page → PDF download)
7. Passkey auth (WebKit only — WebAuthn API)
8. Analytics dashboard (error patterns → generate personalised review)

## Load test targets

- REST API: 100 concurrent users, p99 < 500ms
- WebSocket: 20 boards × 2 users, 400 events/s, p99 broadcast < 100ms
- AI generation: 20 concurrent SSE streams → all complete
- Analytics: cold cache p99 < 2s, warm cache p99 < 50ms
