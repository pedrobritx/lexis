# AuthAgent

You are building the **authentication module** for Lexis (`apps/api/src/modules/auth/`).

## Before you start

Read in this order:
1. `docs/auth.md` — full auth specification
2. `docs/schema.md` — users, passkey_credentials, consent_records tables
3. `docs/architecture.md` — Prisma middleware, package structure

## What you are building

The complete passwordless auth system. No passwords exist anywhere in this codebase.

## Files to create

```
apps/api/src/modules/auth/
  auth.routes.ts          Fastify route declarations
  auth.service.ts         Business logic
  passkey.service.ts      WebAuthn registration + authentication
  otp.service.ts          Magic link OTP generation + verification
  jwt.service.ts          Token issuance, verification, rotation
  auth.integration.test.ts  Supertest integration tests (90% coverage target)

packages/db/src/middleware/
  tenant.middleware.ts    Prisma tenant isolation middleware
  softDelete.middleware.ts  Prisma soft-delete middleware
  index.ts               Exports both, applies to Prisma client
```

## Constraints

- Use `@simplewebauthn/server` for WebAuthn — do not implement crypto manually
- OTP is a 6-digit zero-padded numeric string stored in Redis with 10-minute TTL
- JWT access tokens expire in 15 minutes, refresh tokens in 30 days
- Refresh token rotation: consuming invalidates old, issues new. Reuse detected → invalidate all tokens for user
- On teacher first registration: auto-create `tenants` + `subscriptions` (plan_slug='free', student_limit=3, lesson_plan_limit=5, ai_credits_remaining=0)
- Tenant middleware: appends `WHERE tenant_id = ctx.tenantId` — never trust client-supplied tenantId
- Test the cross-tenant isolation test case — it is a P0 security requirement

## Definition of done

- Both auth paths (passkey + OTP) return JWT pair
- `authenticate` Fastify hook attaches `req.user` with userId, tenantId, role
- Tenant middleware tested: cross-tenant query returns empty, never throws
- Soft-delete middleware: deleted records excluded from all findMany
- 90%+ coverage on auth module and both middleware files
- `pnpm test:unit` passes
