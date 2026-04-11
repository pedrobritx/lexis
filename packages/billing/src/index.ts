import { prisma } from '@lexis/db'

// ─── Types ────────────────────────────────────────────────

export type LimitType = 'students' | 'lesson_plans' | 'storage' | 'ai_credits'

export interface LimitResult {
  allowed: boolean
  current: number
  limit: number | null // null = unlimited
}

// ─── Error ────────────────────────────────────────────────

export class BillingLimitError extends Error {
  statusCode = 402
  code = 'billing/limit_reached'
  details: { current: number; limit: number | null; upgradeRequired: boolean }

  constructor(type: LimitType, current: number, limit: number | null) {
    const labels: Record<LimitType, string> = {
      students: 'student limit',
      lesson_plans: 'lesson plan limit',
      storage: 'storage limit',
      ai_credits: 'AI credit limit',
    }
    super(`You have reached your ${labels[type]} on the current plan.`)
    this.details = { current, limit, upgradeRequired: true }
  }
}

// ─── Helpers ─────────────────────────────────────────────

async function getSubscription(tenantId: string) {
  const sub = await prisma.subscription.findUnique({ where: { tenantId } })
  if (!sub) throw Object.assign(new Error('Subscription not found'), { statusCode: 500 })
  return sub
}

// ─── checkSubscriptionLimit ───────────────────────────────

/**
 * Checks whether a tenant is within their plan's limit for the given type.
 * Returns the current usage and limit.
 * Throws BillingLimitError (402) if the limit is reached.
 */
export async function checkSubscriptionLimit(
  tenantId: string,
  type: LimitType,
): Promise<LimitResult> {
  const sub = await getSubscription(tenantId)

  let current: number
  let limit: number | null

  switch (type) {
    case 'students': {
      limit = sub.studentLimit ?? null
      if (limit === null) return { allowed: true, current: 0, limit: null }

      // Count distinct enrolled students across all classrooms in this tenant
      const rows = await prisma.enrollment.groupBy({
        by: ['studentId'],
        where: { tenantId },
      })
      current = rows.length
      break
    }

    case 'lesson_plans': {
      limit = sub.lessonPlanLimit ?? null
      if (limit === null) return { allowed: true, current: 0, limit: null }

      current = await prisma.course.count({
        where: { tenantId, deletedAt: null },
      })
      break
    }

    case 'storage': {
      const limitBytes = sub.storageLimitBytes ?? null
      if (limitBytes === null) return { allowed: true, current: 0, limit: null }

      const result = await prisma.mediaAsset.aggregate({
        _sum: { sizeBytes: true },
        where: { tenantId },
      })
      const usedBytes = Number(result._sum.sizeBytes ?? 0)
      const limitNum = Number(limitBytes)

      const allowed = usedBytes < limitNum
      if (!allowed) {
        throw new BillingLimitError(type, usedBytes, limitNum)
      }
      return { allowed: true, current: usedBytes, limit: limitNum }
    }

    case 'ai_credits': {
      // -1 = unlimited (Growth plan)
      if (sub.aiCreditsRemaining === -1) return { allowed: true, current: -1, limit: null }

      current = sub.aiCreditsRemaining
      limit = null // ai_credits tracks remaining, not a hard ceiling query

      const allowed = current > 0
      if (!allowed) {
        throw new BillingLimitError(type, 0, 0)
      }
      return { allowed: true, current, limit }
    }
  }

  const allowed = current < limit
  if (!allowed) {
    throw new BillingLimitError(type, current, limit)
  }
  return { allowed: true, current, limit }
}

// ─── decrementAiCredit ────────────────────────────────────

/**
 * Atomically decrements ai_credits_remaining by 1.
 * Throws BillingLimitError if credits = 0.
 * No-op for Growth plan (credits = -1 = unlimited).
 */
export async function decrementAiCredit(tenantId: string): Promise<void> {
  const sub = await getSubscription(tenantId)

  if (sub.aiCreditsRemaining === -1) return // unlimited

  if (sub.aiCreditsRemaining <= 0) {
    throw new BillingLimitError('ai_credits', 0, 0)
  }

  await prisma.subscription.update({
    where: { tenantId },
    data: { aiCreditsRemaining: { decrement: 1 } },
  })
}

// ─── getSubscription (exported) ──────────────────────────

export { getSubscription }
