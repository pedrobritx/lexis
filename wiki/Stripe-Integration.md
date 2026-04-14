# Stripe Integration

---

## Environment variables

```
STRIPE_SECRET_KEY=sk_live_xxx      (sk_test_xxx on staging)
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

---

## Webhook handler

**Route:** `POST /v1/webhooks/stripe`

This route does **not** use the `authenticate` hook — it is authenticated by Stripe webhook signature verification.

### Idempotency (critical)

Before processing any event, check the `billing_events` table:

```typescript
const existing = await prisma.billingEvent.findUnique({
  where: { stripe_event_id: event.id }
})
if (existing) {
  return reply.send({ received: true }) // Already processed — return 200 immediately
}
```

After successful processing, always write to `billing_events`:

```typescript
await prisma.billingEvent.create({
  data: {
    tenantId,
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event,
    processed_at: new Date()
  }
})
```

---

## Events handled

### `checkout.session.completed`

Fired when a teacher completes payment for an upgrade.

```typescript
// Actions:
1. Set subscriptions.plan_slug = target_plan
2. Update student_limit, lesson_plan_limit, ai_credits_remaining
3. Update feature_flags to match new plan
4. Set tenants.stripe_customer_id = event.customer
```

### `invoice.paid`

Fired on subscription renewal (monthly).

```typescript
// Actions:
1. Update subscriptions.renews_at
2. Reset subscriptions.ai_credits_remaining to plan limit
   (Pro: 50, Growth: -1, Free: 0)
```

### `customer.subscription.deleted`

Fired when a teacher cancels or their subscription lapses.

```typescript
// Actions:
1. Downgrade to free plan
2. Reset limits (student_limit = 3, lesson_plan_limit = 5, etc.)
3. Set feature_flags = free tier defaults
4. Set subscriptions.grace_until = now() + 7 days
// NOTE: Do NOT delete any teacher data
```

---

## Stripe Customer Portal

For paying customers to manage their own subscription (card changes, cancellation, invoice history):

```
POST /v1/billing/portal-session
  → Creates Stripe Customer Portal session
  → Returns {url: 'https://billing.stripe.com/session/...'}
  → Client redirects teacher to Stripe-hosted portal
```

Requires `tenants.stripe_customer_id` to be set (happens on `checkout.session.completed`).

---

## Webhook security

Verify every incoming webhook with the Stripe signature:

```typescript
import Stripe from 'stripe'
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const event = stripe.webhooks.constructEvent(
  req.rawBody,           // Raw body — must not be parsed/modified
  req.headers['stripe-signature'],
  process.env.STRIPE_WEBHOOK_SECRET
)
```

If signature verification fails, return 400 immediately without processing.

**Important:** Fastify must be configured to preserve the raw body for this route. Do not apply JSON parsing to `POST /v1/webhooks/stripe`.

---

## Plan limit values

| Plan | student_limit | lesson_plan_limit | ai_credits | storage |
|---|---|---|---|---|
| free | 3 | 5 | 0 | 100MB |
| pro | null (unlimited) | null | 50 | 5GB |
| growth | null | null | -1 (unlimited) | 50GB |

---

## Local testing with Stripe CLI

```bash
# Forward webhooks to local API
stripe listen --forward-to localhost:3000/v1/webhooks/stripe

# Trigger a test event
stripe trigger checkout.session.completed
stripe trigger invoice.paid
stripe trigger customer.subscription.deleted
```

Use `sk_test_` keys and `whsec_` from `stripe listen` output for local dev.
