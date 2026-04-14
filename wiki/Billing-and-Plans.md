# Billing and Plans

---

## Plan tiers

| Feature | Free | Pro | Growth |
|---|---|---|---|
| Students | 3 max | Unlimited | Unlimited |
| Lesson plans (courses) | 5 max | Unlimited | Unlimited |
| AI generation credits | 0 | 50/month | Unlimited |
| Analytics dashboard | — | Full | Full + export |
| Team members | — | — | Up to 5 |
| Custom branding | — | — | Logo + colours |
| Storage | 100MB | 5GB | 50GB |
| Onboarding | Self-serve | Manual approval | Manual approval |

---

## Limit enforcement

Limits are checked by the `checkSubscriptionLimit()` helper in `packages/billing`:

```typescript
type LimitType = 'students' | 'lesson_plans' | 'storage' | 'ai_credits'

// Returns: { allowed: boolean, current: number, limit: number | null }
// limit = null means unlimited
// Throws BillingLimitError (402) if not allowed
await checkSubscriptionLimit(tenantId, 'students')
```

### Where each limit is checked

| Limit | Route |
|---|---|
| `students` | `POST /v1/classrooms/:id/enroll` |
| `lesson_plans` | `POST /v1/courses` |
| `storage` | `POST /v1/media/upload` |
| `ai_credits` | `POST /v1/ai/generate` |

### 402 response shape

```json
{
  "error": {
    "code": "billing/limit_reached",
    "message": "You have reached your student limit on the free plan.",
    "details": {
      "current": 3,
      "limit": 3,
      "upgradeRequired": true
    }
  }
}
```

### Student count implementation

For the student limit check, count across all classrooms in the tenant (not per-classroom):

```sql
SELECT COUNT(DISTINCT student_id) FROM enrollments WHERE tenant_id = ?
```

Use a PostgreSQL transaction to prevent race conditions on concurrent enrollment.

---

## Feature flags

`subscriptions.feature_flags` is a jsonb column. Never hardcode plan logic in route handlers — always check feature flags:

```typescript
const { feature_flags } = await getSubscription(req.user.tenantId)
if (!feature_flags.ai) {
  throw new ForbiddenError('billing/feature_not_available', 'AI generation requires Pro plan')
}
```

### Default flags per plan

```json
// Free
{ "ai": false, "analytics": false, "team": false, "branding": false }

// Pro
{ "ai": true, "analytics": true, "team": false, "branding": false }

// Growth
{ "ai": true, "analytics": true, "team": true, "branding": true }
```

Feature flags can be individually overridden per tenant (e.g. for trials or manual grants) without changing the plan slug.

---

## AI credit system

```typescript
// subscriptions.ai_credits_remaining:
// -1 = unlimited (Growth tier)
//  0 = exhausted (Free tier default)
//  N = credits remaining

async function decrementAiCredit(tenantId: string) {
  const sub = await getSubscription(tenantId)
  if (sub.ai_credits_remaining === -1) return  // Growth: unlimited, no-op
  if (sub.ai_credits_remaining === 0) {
    throw new BillingError('billing/insufficient_credits', 'No AI credits remaining')
  }
  // Atomic decrement — prevents race condition with concurrent requests
  await prisma.$transaction(async (tx) => {
    const updated = await tx.subscription.update({
      where: { tenantId, ai_credits_remaining: { gt: 0 } },
      data: { ai_credits_remaining: { decrement: 1 } }
    })
    if (!updated) throw new BillingError('billing/insufficient_credits', 'Race condition')
  })
}
```

Monthly credit reset is triggered by the `invoice.paid` Stripe webhook → `UPDATE subscriptions SET ai_credits_remaining = plan_limit WHERE tenant_id = ?`.

---

## Upgrade request flow

This is the current upgrade path (manual approval before Stripe integration is live):

1. Teacher hits a limit → UI shows upgrade prompt
2. Teacher clicks upgrade → `POST /v1/billing/upgrade-request` with `{targetPlan, motivation}`
3. API creates `upgrade_requests` row with `status = 'pending'`
4. Sends admin email (Pedro) via Resend with teacher profile + one-click approve URL
5. Pedro clicks approve → `POST /v1/admin/upgrade-requests/:id/approve`
6. Sets `status = 'approved'`, creates Stripe checkout session, emails teacher with payment link
7. Teacher pays → Stripe webhook fires → subscription activated

See [[Stripe-Integration]] for the full Stripe webhook flow.

---

## Subscription downgrade on cancellation

When `customer.subscription.deleted` webhook fires:
- Downgrade to free plan (reset all limits)
- **Do NOT delete data** — teacher keeps their content, it simply becomes inaccessible over limits
- Grace period: 7 days before limits are enforced (`subscriptions.grace_until = now() + 7 days`)
- After grace period: routes enforcing limits will start returning 402 again
