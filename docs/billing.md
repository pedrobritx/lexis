# Billing

## Tiers

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

## Enforcement

Limits are checked by a `checkSubscriptionLimit(tenantId, type)` helper in `packages/billing`.

```typescript
type LimitType = 'students' | 'lesson_plans' | 'storage' | 'ai_credits'

// Returns { allowed: boolean, current: number, limit: number | null }
// limit = null means unlimited
// Throws BillingLimitError (402) if not allowed
```

**Where limits are checked:**
- `POST /v1/classrooms/:id/enroll` → checks `students`
- `POST /v1/courses` → checks `lesson_plans`
- `POST /v1/media/upload` → checks `storage` (bytes)
- `POST /v1/ai/generate` → checks `ai_credits`

**Implementation:** check against `subscriptions` table. For student count, query `COUNT(DISTINCT student_id) FROM enrollments WHERE tenant_id = ?`. Use PostgreSQL transaction to prevent race conditions on concurrent enrollment.

**402 response shape:**
```json
{
  "error": {
    "code": "billing/limit_reached",
    "message": "You have reached your student limit on the free plan.",
    "details": { "current": 3, "limit": 3, "upgradeRequired": true }
  }
}
```

## Feature flags

`subscriptions.feature_flags` is a jsonb column. Never hardcode plan logic in routes — always check feature flags:

```typescript
// In route handler:
const { feature_flags } = await getSubscription(req.user.tenantId)
if (!feature_flags.ai) {
  throw new ForbiddenError('billing/feature_not_available', 'AI generation requires Pro plan')
}
```

**Default feature_flags per plan:**
```json
// Free
{ "ai": false, "analytics": false, "team": false, "branding": false }

// Pro
{ "ai": true, "analytics": true, "team": false, "branding": false }

// Growth
{ "ai": true, "analytics": true, "team": true, "branding": true }
```

## Stripe integration

### Setup
```
STRIPE_SECRET_KEY=sk_live_xxx   (sk_test_xxx on staging)
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

### Webhook handler — POST /v1/webhooks/stripe

**Idempotency:** before processing any event, check `billing_events` table for `stripe_event_id`. If found, return 200 immediately without reprocessing.

**Events to handle:**
```
checkout.session.completed
  → Set subscriptions.plan_slug = target_plan
  → Update student_limit, lesson_plan_limit, ai_credits_remaining, feature_flags
  → Set tenants.stripe_customer_id

invoice.paid
  → Update subscriptions.renews_at
  → Reset subscriptions.ai_credits_remaining to plan limit

customer.subscription.deleted
  → Downgrade to free plan (reset limits)
  → Do NOT delete data — teacher keeps their content on free limits
  → Grace period: 7 days before limits are enforced (set subscriptions.grace_until)
```

**After handling:** always write to `billing_events` table with the Stripe event ID.

### Upgrade request flow

1. Teacher hits a limit → `POST /v1/billing/upgrade-request` with `{targetPlan, motivation}`
2. Creates `upgrade_requests` row with `status = 'pending'`
3. Sends admin email (Pedro) via Resend with teacher profile + one-click approve URL
4. Admin clicks approve URL → `POST /v1/admin/upgrade-requests/:id/approve`
5. Sets `status = 'approved'`, creates Stripe checkout session, emails teacher with payment link
6. Teacher pays → Stripe webhook → subscription activated

### Stripe Customer Portal

For existing paying customers to manage their subscription:

```
POST /v1/billing/portal-session
  → Creates Stripe Customer Portal session
  → Returns {url: 'https://billing.stripe.com/session/...'}
  → Client redirects teacher to Stripe
```

Stripe handles: card changes, cancellation, invoice history, plan changes.

## Credit tracking (AI)

```typescript
// Before any generation call:
await decrementAiCredit(tenantId)
// Atomically decrements ai_credits_remaining
// Throws InsufficientCreditsError if credits = 0
// No-op for Growth (credits = -1 = unlimited)

// Credit reset on billing renewal:
// billing.renewed event → set ai_credits_remaining back to plan limit
```

Monthly reset is triggered by `invoice.paid` Stripe webhook.
