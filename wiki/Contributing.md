# Contributing

Rules and workflow for contributing to Lexis.

---

## Non-negotiable rules

These rules are enforced in code review and CI. Violations block merge.

| Rule | Why |
|---|---|
| Never hard-code `tenant_id` | Always read from `req.user.tenantId` extracted from JWT |
| Never hard-delete rows | On Course, Unit, Lesson, Activity, User — always `softDelete()` |
| Never save AI output directly | Drafts only — teacher must explicitly approve before saving to a course |
| Never skip the credit check | Before any AI generation call, `decrementAiCredit()` must be called |
| Never write `console.log` | Use `pino` logger from `packages/logger` |
| Never commit secrets | All secrets go in Railway/Vercel/GitHub environment variables |

---

## Branch naming

```
feat/short-description       New feature
fix/short-description        Bug fix
chore/short-description      Tooling, dependencies, config
docs/short-description       Documentation only
```

Examples:
```
feat/srs-stale-content-detection
fix/enrollment-limit-race-condition
chore/upgrade-prisma-5
```

---

## Commit conventions

Use imperative mood, present tense:

```
feat: add SRS stale content version detection
fix: prevent race condition on concurrent enrollment
chore: upgrade Prisma to 5.x
docs: update API-Reference with media endpoints
```

---

## PR workflow

1. Create branch from `main`
2. Implement + write tests
3. Run locally: `pnpm typecheck && pnpm lint && pnpm test`
4. Open PR — CI runs automatically (see [[CI-CD-Pipelines]])
5. All 5 CI stages must pass before merge:
   - Stage 1: typecheck + lint (30s)
   - Stage 2: unit tests + coverage gates (1min)
   - Stage 3: integration + RT tests (3min)
   - Stage 4: staging deploy (2min)
   - Stage 5: Playwright E2E on staging (2min)
6. PR cannot merge until CI is green — no exceptions

---

## Coverage gates

| Module | Minimum |
|---|---|
| `modules/auth` | 90% lines + functions |
| `modules/billing` | 90% lines + functions |
| `modules/srs` | 90% lines + functions |
| `db/middleware` | 90% lines + functions |
| Everything else | 70% lines + functions |

If your PR drops coverage below the gate for any module, CI fails.

---

## Code style

- TypeScript strict mode everywhere
- No `any` types — use `unknown` and narrow properly
- Prettier for formatting (runs on commit via husky)
- ESLint for rules (runs on commit + CI)
- No unused imports

---

## Test requirements

Every PR that touches logic must include tests. See [[Testing-Strategy]] for the full guide.

Quick rules:
- Unit tests live next to the file: `foo.ts` → `foo.test.ts`
- Integration tests live in `apps/api/test/`
- Use `createTestTenant()` and `createTestStudent()` helpers — never seed data manually
- Wrap each integration test in a DB transaction and roll back after

---

## Build agents

Lexis uses domain-specific build agents in `agents/`. When implementing a module for the first time, consult the relevant agent file first — it contains the complete implementation spec for that domain. See [[Build-Agents]] for the full list.

---

## Reading the docs before writing code

The `docs/` directory is the source of truth. Always read the relevant doc before touching a module:

| You're touching... | Read first |
|---|---|
| Auth, JWT, passkeys | `docs/auth.md` |
| Billing, limits, Stripe | `docs/billing.md` |
| Prisma, schema, migrations | `docs/schema.md` |
| Socket.IO, RT server | `docs/realtime.md` |
| AI generation, prompts | `docs/ai.md` |
| Tests | `docs/testing.md` |
| Deploy, CI, secrets | `docs/devops.md` |
