# Prisma Middleware

Two mandatory middleware layers are applied to the Prisma client in `packages/db/src/middleware/`. Both must be active in production at all times and must not be removed or bypassed.

---

## Layer 1 — Tenant isolation

Appends `WHERE tenant_id = {ctx.tenantId}` to all `findMany`, `findFirst`, `update`, and `delete` operations on mutable tables.

### Purpose

Prevents a teacher in tenant A from ever reading or modifying data belonging to tenant B, even if there is a bug in a route handler that passes the wrong ID.

### How it works

```typescript
// packages/db/src/middleware/tenantIsolation.ts

prisma.$use(async (params, next) => {
  const ctx = getTenantContext() // AsyncLocalStorage
  if (!ctx?.tenantId) {
    throw new MissingTenantContextError()
  }

  const mutableModels = [
    'Course', 'Unit', 'Lesson', 'Activity',
    'Enrollment', 'Classroom', 'Session',
    'LessonProgress', 'ActivityAttempt', 'SrsItem',
    // ... all tenant-scoped models
  ]

  if (mutableModels.includes(params.model)) {
    if (params.action === 'findMany' || params.action === 'findFirst') {
      params.args.where = { ...params.args.where, tenant_id: ctx.tenantId }
    }
    if (params.action === 'update' || params.action === 'delete') {
      params.args.where = { ...params.args.where, tenant_id: ctx.tenantId }
    }
  }

  return next(params)
})
```

### Bypass rules

The following are intentionally bypassed:
- `users` table — looked up by email during auth before tenant context is established
- `passkey_credentials` table — same reason
- `consent_records` table — same reason
- `courses` with `visibility = 'public_template'` — public templates are cross-tenant by design

### Testing requirement

Tenant middleware must maintain **90% coverage**. The critical test cases are:

- `findMany` on a mutable model appends `tenant_id` filter
- Cross-tenant query returns empty, not data from another tenant
- Missing tenant context throws `MissingTenantContextError`
- `public_template` courses bypass the filter

---

## Layer 2 — Soft-delete filter

Appends `WHERE deleted_at IS NULL` to all `findMany` and `findFirst` operations on soft-deletable models.

### Purpose

Prevents accidentally returning deleted records in list queries without requiring every route handler to manually add `deleted_at: null`.

### How it works

```typescript
// packages/db/src/middleware/softDelete.ts

const softDeleteModels = ['Course', 'Unit', 'Lesson', 'Activity', 'User']

prisma.$use(async (params, next) => {
  if (softDeleteModels.includes(params.model)) {
    if (params.action === 'findMany' || params.action === 'findFirst') {
      params.args.where = { ...params.args.where, deleted_at: null }
    }
  }
  return next(params)
})
```

### The `softDelete` helper

**Never call `prisma.course.delete()` directly.** Always use the helper:

```typescript
import { softDelete } from '@lexis/db'

// Sets deleted_at = now()
await softDelete('course', courseId)

// Equivalent SQL:
// UPDATE courses SET deleted_at = NOW() WHERE id = ? AND tenant_id = ?
```

The helper:
1. Calls `prisma[model].update({ where: { id }, data: { deleted_at: new Date() } })`
2. Is protected by the tenant isolation middleware (tenant_id is appended automatically)

### Models with soft-delete

| Model | Soft-deletable |
|---|---|
| `Course` | ✅ |
| `Unit` | ✅ |
| `Lesson` | ✅ |
| `Activity` | ✅ |
| `User` | ✅ (GDPR) |
| All others | ❌ (hard-delete or status field) |

### Testing requirement

Soft-delete middleware must maintain **90% coverage**. Critical test cases:

- `findMany` on soft-deletable model excludes `deleted_at IS NOT NULL` rows
- `softDelete()` sets `deleted_at` without removing the row
- Calling `prisma.course.delete()` directly fails ESLint rule (rule configured in `.eslintrc`)

---

## Middleware order

Both middleware layers are applied in this order:

```
Request → tenantIsolation → softDelete → Prisma query → Database
```

Both must be present. Neither is optional.

---

## How to set tenant context

Tenant context is stored in AsyncLocalStorage and set by the `authenticate` Fastify hook before any handler runs:

```typescript
// hooks/authenticate.ts
fastify.addHook('preHandler', async (req, reply) => {
  const payload = verifyAccessToken(req.headers.authorization)
  req.user = payload

  // Set AsyncLocalStorage context so Prisma middleware can read it
  setTenantContext({ tenantId: payload.tenantId })
})
```

Every route that uses Prisma must be protected by the `authenticate` hook.
