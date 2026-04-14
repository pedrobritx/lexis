# Testing Strategy

---

## Philosophy — three coverage tiers

| Tier | Coverage | Modules |
|---|---|---|
| Critical | 90% lines + functions | Auth, billing, SRS algorithm, Prisma middleware |
| Important | 70% lines + functions | Activity validators, gamification, analytics, AI prompts |
| Covered by higher layers | No unit test requirement | UI components, simple CRUD routes |

**CI gate:** all tests must pass and all coverage gates must be met before merge to `main`. No exceptions.

---

## Tools

| Tool | Role |
|---|---|
| Vitest | Unit tests + RT event tests (all packages) |
| Supertest | Integration tests (API routes with real DB + Redis) |
| Playwright | E2E tests (browser flows against staging) |
| socket.io-client | RT event sequence tests (in-process server) |
| Artillery | Load tests (weekly — not a CI gate) |
| Docker Compose | Isolated test DB (postgres:5433, redis:6380) |

---

## Commands

```bash
pnpm test              # All tests (CI order)
pnpm test:unit         # Vitest unit tests only
pnpm test:integration  # Supertest + Docker DB
pnpm test:realtime     # socket.io-client event tests
pnpm test:e2e          # Playwright against staging
pnpm test:coverage     # Unit + integration with coverage report
pnpm test:load         # Artillery load tests (weekly, not in CI)
```

---

## Vitest workspace configuration

Coverage thresholds per module path:

```typescript
// vitest.workspace.ts
export default defineWorkspace([
  {
    test: {
      include: ['**/modules/auth/**/*.test.ts'],
      coverage: { thresholds: { lines: 90, functions: 90 } }
    }
  },
  {
    test: {
      include: ['**/modules/billing/**/*.test.ts'],
      coverage: { thresholds: { lines: 90, functions: 90 } }
    }
  },
  {
    test: {
      include: ['**/modules/srs/**/*.test.ts', '**/packages/srs/**/*.test.ts'],
      coverage: { thresholds: { lines: 90, functions: 90 } }
    }
  },
  {
    test: {
      include: ['**/db/middleware/**/*.test.ts'],
      coverage: { thresholds: { lines: 90, functions: 90 } }
    }
  },
  {
    test: {
      include: ['**/*.test.ts'],
      coverage: { thresholds: { lines: 70, functions: 70 } }
    }
  }
])
```

---

## Integration test setup

### Docker services

```yaml
# docker-compose.test.yml
services:
  postgres-test:
    image: postgres:16
    ports: ["5433:5432"]
    environment:
      POSTGRES_DB: lexis_test
      POSTGRES_PASSWORD: test
  redis-test:
    image: redis:7
    ports: ["6380:6379"]
```

### Global setup (runs once before all integration tests)

```typescript
// test/globalSetup.ts
export async function setup() {
  // 1. Start Docker services
  execSync('docker compose -f docker-compose.test.yml up -d')
  await waitForHealthy()

  // 2. Apply all migrations
  execSync('DATABASE_URL=... pnpm prisma migrate deploy')

  // 3. Seed system data
  execSync('DATABASE_URL=... pnpm prisma db seed')
}

export async function teardown() {
  execSync('docker compose -f docker-compose.test.yml down')
}
```

### Per-test isolation

Each integration test wraps DB operations in a transaction:

```typescript
// test/helpers/setup.ts
beforeEach(async () => {
  tx = await prisma.$transaction((t) => t)
  // Override prisma with transaction client
  jest.spyOn(prismaModule, 'prisma', 'get').mockReturnValue(tx)
})

afterEach(async () => {
  await tx.$rollback()
})
```

---

## Test helpers

Import from `test/helpers/`:

```typescript
// Creates tenant + teacher + free subscription
const { tenantId, teacherId } = await createTestTenant()

// Creates student enrolled in a classroom
const { studentId } = await createTestStudent(tenantId)

// Issues JWT, returns Authorization header value
const authHeader = await getAuthHeader(userId)
// → { Authorization: 'Bearer eyJ...' }
```

Never seed test data manually — always use helpers. This ensures consistent data shape and avoids brittle tests.

---

## RT event testing

Socket.IO event sequences are tested with an in-process server:

```typescript
import { createServer } from 'http'
import { Server } from 'socket.io'
import { io as Client } from 'socket.io-client'

let server: Server, clientSocket: Socket

beforeAll((done) => {
  const httpServer = createServer()
  server = new Server(httpServer)
  httpServer.listen(() => {
    clientSocket = Client(`http://localhost:${port}`, {
      auth: { token: validJwt }
    })
    clientSocket.on('connect', done)
  })
})

it('should emit board:state on board:join', (done) => {
  clientSocket.emit('board:join', { pageId: testPageId })
  clientSocket.on('board:state', (data) => {
    expect(data.objects).toBeDefined()
    done()
  })
})
```

---

## Load test targets

Run weekly with Artillery (not a CI gate):

| Scenario | Target |
|---|---|
| REST API | 100 concurrent users, p99 < 500ms |
| WebSocket | 20 boards × 2 users, 400 events/s, p99 broadcast < 100ms |
| AI generation | 20 concurrent SSE streams — all complete successfully |
| Analytics (cold cache) | p99 < 2s |
| Analytics (warm cache) | p99 < 50ms |
