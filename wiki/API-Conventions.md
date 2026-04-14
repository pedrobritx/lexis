# API Conventions

All REST API routes follow these conventions. Deviating from them will fail code review.

---

## Response shapes

### Success

```typescript
// Single resource
{ data: T }

// Collection
{ data: T[], meta: { page: number, total: number } }
```

### Error

```typescript
{
  error: {
    code: string      // standardised code (see below)
    message: string   // human-readable
    details?: unknown // optional extra context
  }
}
```

---

## Standardised error codes

### Auth errors

| Code | HTTP | Meaning |
|---|---|---|
| `auth/invalid_token` | 401 | Token fails signature verification |
| `auth/expired_token` | 401 | Token is past its `exp` claim |
| `auth/missing_token` | 401 | No Authorization header present |
| `auth/invalid_otp` | 401 | OTP code wrong or not found |

### Billing errors

| Code | HTTP | Meaning |
|---|---|---|
| `billing/limit_reached` | 402 | Plan limit hit (students, courses, storage) |
| `billing/insufficient_credits` | 402 | AI credits exhausted |
| `billing/feature_not_available` | 403 | Feature requires a higher plan |

### Resource errors

| Code | HTTP | Meaning |
|---|---|---|
| `resource/not_found` | 404 | Entity doesn't exist or not in tenant scope |
| `resource/already_exists` | 409 | Unique constraint would be violated |
| `resource/soft_deleted` | 410 | Entity exists but has `deleted_at` set |

### Permission errors

| Code | HTTP | Meaning |
|---|---|---|
| `permission/tenant_mismatch` | 403 | Resource belongs to a different tenant |
| `permission/role_required` | 403 | Route requires a role the caller doesn't have |

### Realtime errors

| Code | HTTP/Event | Meaning |
|---|---|---|
| `rt/lock_rejected` | Event | Object is locked by another user |

---

## Route naming

```
POST   /v1/auth/magic/request
POST   /v1/auth/magic/verify
POST   /v1/auth/passkey/register/begin
POST   /v1/auth/passkey/register/complete
POST   /v1/auth/passkey/login/begin
POST   /v1/auth/passkey/login/complete
POST   /v1/auth/refresh
POST   /v1/auth/logout

GET    /v1/users/me
PATCH  /v1/users/me
DELETE /v1/users/me

GET    /v1/courses
POST   /v1/courses
GET    /v1/courses/:id
PATCH  /v1/courses/:id
DELETE /v1/courses/:id         (soft-delete)

GET    /v1/templates
POST   /v1/templates/:id/clone

GET    /v1/health               (no auth required)
GET    /openapi.json            (no auth required)
```

See [[API-Reference]] for the complete endpoint list.

---

## Versioning

All routes are prefixed with `/v1/`. When a breaking change is needed, a `/v2/` route is added and `/v1/` is kept for a deprecation window. Never change `/v1/` behaviour in a breaking way.

---

## Authentication hook

Every protected route uses the `authenticate` Fastify preHandler hook:

```typescript
fastify.addHook('preHandler', authenticate)

// authenticate:
// 1. Reads Authorization: Bearer {token}
// 2. Verifies JWT signature + expiry
// 3. Attaches req.user = { userId, tenantId, role }
// 4. Throws 401 with appropriate error code on failure
```

**Rule:** never read `tenantId` from request body or query params. Always use `req.user.tenantId`.

---

## Pagination

Collection endpoints accept:
```
GET /v1/courses?page=1&limit=20
```

And return:
```json
{
  "data": [...],
  "meta": { "page": 1, "total": 47 }
}
```

Default `limit` is 20. Maximum is 100.

---

## Swagger / OpenAPI

Interactive docs are available at `/docs` (local) and `api.lexis.app/docs` (production).

The raw OpenAPI JSON is at `/openapi.json` and is used to generate native clients:

```bash
pnpm generate:clients
```
