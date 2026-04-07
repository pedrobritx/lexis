# BillingAgent

You are building the **billing module** for Lexis (`apps/api/src/modules/billing/`).

## Before you start

Read in this order:
1. `docs/billing.md` — full billing specification
2. `docs/schema.md` — subscriptions, upgrade_requests, billing_events, usage_snapshots
3. `docs/auth.md` — how tenantId is extracted (needed for limit checks)

## What you are building

Freemium enforcement, Stripe webhook handling, upgrade request flow, AI credit tracking, and the usage snapshot cron job.

## Files to create

```
apps/api/src/modules/billing/
  billing.routes.ts
  billing.service.ts
  stripe.webhook.ts       Webhook handler + idempotency guard
  billing.integration.test.ts  (90% coverage target)

packages/billing/
  src/limits.ts           checkSubscriptionLimit() helper
  src/credits.ts          decrementAiCredit() helper
  src/index.ts
```

## Key implementation details

### Limit enforcement
`checkSubscriptionLimit` must use a PostgreSQL transaction to prevent race conditions on concurrent enrollment. Two simultaneous requests at 2/3 students must result in exactly one succeeding.

### Stripe webhook idempotency
Before processing any Stripe event:
1. Check `billing_events` table for this `stripe_event_id`
2. If found → return 200, do nothing
3. If not found → process event, then write to `billing_events`

Never process the same event twice.

### Webhook signature verification
```typescript
const event = stripe.webhooks.constructEvent(
  rawBody,   // must be raw Buffer, not parsed JSON
  sig,
  process.env.STRIPE_WEBHOOK_SECRET
)
```
Fastify must receive the raw body for this endpoint — add `config: { rawBody: true }` to the route.

### Usage snapshots
BullMQ cron at midnight: for each active tenant, count students, courses, storage bytes, AI credits used, sessions. Upsert into `usage_snapshots`. This feeds the teacher's usage dashboard.

## Definition of done

- Free tenant: 4th student enrollment → 402 with `billing/limit_reached`
- Free tenant: 6th course creation → 402
- Stripe `invoice.paid` webhook → updates subscription, resets AI credits
- Same webhook event sent twice → second call is no-op (idempotency)
- Pro tenant: no limits enforced
- AI credit decrement: atomic, concurrent-safe, 402 at zero
- 90%+ coverage on billing module and limit helpers
