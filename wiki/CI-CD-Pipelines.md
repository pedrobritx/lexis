# CI/CD Pipelines

Two GitHub Actions workflows drive the entire deployment process.

---

## `ci.yml` — runs on every push and every PR

5 stages must all pass before a PR can merge to `main`.

| Stage | What runs | Target time |
|---|---|---|
| 1 | TypeScript check + ESLint | 30s |
| 2 | `pnpm test:unit` + coverage gates | 1 min |
| 3 | `pnpm test:integration` + `pnpm test:realtime` (Docker services) | 3 min |
| 4 | Railway staging deploy | 2 min |
| 5 | Playwright E2E tests against staging | 2 min |

**Total target: ~8 minutes.** No stage is skippable. A PR cannot merge until all 5 are green.

### Stage 3 — Docker services

Integration tests spin up isolated Postgres and Redis:

```yaml
services:
  postgres:
    image: postgres:16
    ports: ["5433:5432"]
    env:
      POSTGRES_DB: lexis_test
      POSTGRES_PASSWORD: test
  redis:
    image: redis:7
    ports: ["6380:6379"]
```

After services are healthy:
```bash
pnpm prisma migrate deploy  # Apply migrations to test DB
pnpm prisma db seed         # Seed system tenant + CEFR templates
pnpm test:integration
pnpm test:realtime
```

### Stage 4 — Staging deploy

```yaml
- name: Deploy to Railway staging
  run: railway up --service api --environment staging
  env:
    RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

Both API and RT server are deployed. Health checks must pass before stage 5 runs.

---

## `deploy-prod.yml` — runs only on merge to `main`

```
1. Verify ci.yml passed on this exact SHA
2. Run: pnpm prisma migrate deploy (against production DB via DIRECT_URL)
3. Railway deploy API — rolling, waits for /v1/health
4. Railway deploy RT server — 30s graceful drain on SIGTERM
5. Vercel deploys automatically via Git integration (no manual step needed)
6. Smoke test: curl /v1/health on api.lexis.app, rt.lexis.app, lexis.app
7. Git tag: v{major}.{minor}.{patch}
```

### Migration-before-code rule

**Migrations always run before code deploys.** Every migration must be backwards-compatible with the currently-running version of the code — this allows safe rollback.

Rules for safe migrations:
- Adding a nullable column: always safe
- Adding a non-nullable column: always add with a default value first
- Renaming a column: add new column, deploy code that writes both, then drop old column
- Removing a column: deploy code that no longer reads it first, then drop

### Rollback procedure

If production deploy fails after migrations:
1. Identify the last healthy Railway deployment (keep it warm for 5 minutes)
2. Re-deploy the previous Railway image (Railway keeps last 5 deploys)
3. Migrations do NOT need to be rolled back (backwards-compatible rule)
4. Fix the issue in a new PR → merge → deploy-prod.yml runs again

---

## Required GitHub Secrets

| Secret | Used in |
|---|---|
| `RAILWAY_TOKEN` | ci.yml stage 4, deploy-prod.yml step 3+4 |
| `SUPABASE_DIRECT_URL` | deploy-prod.yml step 2 (migration) |
| `PLAYWRIGHT_BASE_URL` | ci.yml stage 5 |
| `STAGING_API_KEY` | ci.yml stage 5 (seed test user JWT) |

See [[Environment-Variables]] for the complete list.

---

## Branch protection rules

On `main`:
- Require status checks: ci.yml all stages
- Require linear history (no merge commits)
- Require at least 1 approver (when team grows beyond solo)
- No force pushes

---

## OpenAPI client check

After any route change, CI verifies that `pnpm generate:clients` produces a compilable Swift client:

```yaml
- name: Verify OpenAPI clients
  run: |
    pnpm generate:clients
    cd apps/ios && swift build
```

This ensures the iOS app's generated client stays in sync with the API.
